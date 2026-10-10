"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BatchConflictError, commitBatch, expectRows, prisma, retryOnConflict } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { checkAndAlertLowStockMany } from "@/lib/stock-alerts";
import { recordStockCount } from "@/lib/stock-count";
import { stockDeltaOps, stockUnchanged } from "@/lib/stock";
import { getTranslations } from "next-intl/server";

type SaveShelfResult =
  | {
      success: true;
      /** Cans written off as loss — the ones this period's drinkers pay for. */
      billed: number;
      /** Cans moved as a free correction, billed to nobody. */
      corrected: number;
      /** How many items had their reorder threshold written. */
      thresholds: number;
    }
  | { success: false; error: string };

const QuantitySchema = z.object({
  itemId: z.string().min(1),
  // Bounded: a mistyped count writes phantom cans straight into the value
  // pool and rewrites the office's prices.
  qty: z.coerce.number().int().min(0).max(10_000),
  /**
   * What this row's gap means, chosen per item because one count is rarely
   * one story: the mint really did run dry while the classic was just miscounted.
   * LOSS bills the gap as shrinkage to the period's drinkers; CORRECTION only
   * repairs the books and costs nobody anything.
   */
  mode: z.enum(["LOSS", "CORRECTION"]).default("LOSS"),
});

const ThresholdSchema = z.object({
  itemId: z.string().min(1),
  // Null means "follow the office", stored as null rather than as a copy of
  // the office number: a copy would silently stop tracking the office setting
  // the moment someone changed it.
  threshold: z.coerce.number().int().min(0).max(100_000).nullable(),
});

const SaveShelfSchema = z.object({
  quantities: z.array(QuantitySchema),
  thresholds: z.array(ThresholdSchema),
  note: z.string().max(200).optional().or(z.literal("")),
});

/**
 * Writes the shelf: the quantities an admin counted, the reorder thresholds
 * they retuned, or both, in one round trip.
 *
 * One action because the screen has one save button — a half-applied shelf,
 * where the thresholds moved but the count did not, is a state nobody asked
 * for and nobody could see.
 */
export async function saveShelf(
  officeId: string,
  formData: FormData,
): Promise<SaveShelfResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { success: false, error: t("stock.nothingToSave") };
  }

  const parsed = SaveShelfSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { quantities, thresholds } = parsed.data;
  const note = parsed.data.note || null;

  if (quantities.length === 0 && thresholds.length === 0) {
    return { success: false, error: t("stock.nothingToSave") };
  }

  // Every id is checked against this office before anything is written: one
  // foreign item in the payload must not leave the rest half-applied.
  const ids = [
    ...new Set([
      ...quantities.map((q) => q.itemId),
      ...thresholds.map((th) => th.itemId),
    ]),
  ];
  const known = await prisma.item.findMany({
    where: { officeId, id: { in: ids } },
    select: { id: true },
  });
  if (known.length !== ids.length) {
    return { success: false, error: t("errors.itemNotFound") };
  }

  if (thresholds.length > 0) {
    // Independent writes, committed together: no read to guard.
    await commitBatch((db) =>
      thresholds.map((th) =>
        db.item.updateMany({
          where: { id: th.itemId, officeId },
          data: { lowStockThreshold: th.threshold },
        }),
      ),
    );
  }

  let billed = 0;
  let corrected = 0;

  const losses = quantities.filter((q) => q.mode === "LOSS");
  const fixes = quantities.filter((q) => q.mode === "CORRECTION");

  if (losses.length > 0) {
    // Routed through the count writer: that is the one path `@/lib/costing`
    // reads shrinkage from, so cans written off here are billed exactly like
    // cans found missing by a full count.
    const outcome = await recordStockCount({
      officeId,
      userId: membership.userId,
      counts: losses.map((q) => ({ itemId: q.itemId, countedQty: q.qty })),
      note,
    });
    if (!outcome.ok) {
      return { success: false, error: t("errors.itemNotFound") };
    }
    billed = outcome.result.missing + outcome.result.surplus;
    checkAndAlertLowStockMany(
      officeId,
      outcome.result.gaps.map((g) => g.itemId),
    );
  }

  if (fixes.length > 0) {
    const gaps = await applyCorrections({
      officeId,
      userId: membership.userId,
      quantities: fixes,
      note,
    });
    corrected = gaps.reduce((sum, g) => sum + Math.abs(g.delta), 0);
    checkAndAlertLowStockMany(
      officeId,
      gaps.map((g) => g.itemId),
    );
  }

  revalidateShelf(officeId);

  return {
    success: true,
    billed,
    corrected,
    thresholds: thresholds.length,
  };
}

/**
 * Moves stock to the quantities given without billing anyone: the gap is
 * recorded as an ADJUSTMENT, which `@/lib/costing` ignores.
 *
 * Current quantities are read, the gaps computed, then everything is written
 * in one atomic batch whose guards require every pool to still be at the level
 * read. A round served in between rolls the batch back and the corrections
 * are computed again from the fresh levels, so it is not silently overwritten
 * by a number typed minutes ago.
 */
async function applyCorrections(opts: {
  officeId: string;
  userId: string;
  quantities: { itemId: string; qty: number }[];
  note: string | null;
}): Promise<{ itemId: string; delta: number }[]> {
  const { officeId, userId, quantities, note } = opts;
  return retryOnConflict(async () => {
    const stocks = await prisma.stock.findMany({
      where: { officeId, itemId: { in: quantities.map((q) => q.itemId) } },
      select: { itemId: true, currentQty: true },
    });
    const currentByItem = new Map(stocks.map((s) => [s.itemId, s.currentQty]));

    const gaps = quantities
      .map((q) => ({
        itemId: q.itemId,
        delta: q.qty - (currentByItem.get(q.itemId) ?? 0),
      }))
      .filter((g) => g.delta !== 0);

    if (gaps.length > 0) {
      await commitBatch((db) => [
        ...gaps.map((g) => stockUnchanged(db, officeId, g.itemId, currentByItem.get(g.itemId))),
        ...gaps.flatMap((g) =>
          stockDeltaOps(db, {
            officeId,
            itemId: g.itemId,
            delta: g.delta,
            reason: "ADJUSTMENT",
            note,
            userId,
          }),
        ),
      ]);
    }
    return gaps;
  });
}

/** Everything a shelf write moves: the stock, the bills, and what people owe. */
function revalidateShelf(officeId: string) {
  revalidatePath(`/org/${officeId}/admin/stock`);
  revalidatePath(`/org/${officeId}/admin/items`);
  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/runner`);
  // A count moves what members owe, so their own screens are stale too.
  revalidatePath(`/org/${officeId}/reimbursements`);
  revalidatePath(`/org/${officeId}/dashboard`);
}

type CancelCountResult =
  | { success: true; restored: number }
  | { success: false; error: string };

/**
 * Undoes a recorded count: the cans it wrote off come back to the shelf and
 * its shrinkage stops being billed.
 *
 * Refused once the period's statements have gone out — at that point people
 * have been told what they owe, and quietly rewriting the bill behind them is
 * worse than living with a wrong count.
 */
export async function cancelStockCount(
  officeId: string,
  countId: string,
): Promise<CancelCountResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const count = await prisma.stockCount.findFirst({
    where: { id: countId, officeId },
    select: {
      id: true,
      countedAt: true,
      cancelledAt: true,
      lines: { select: { itemId: true, delta: true } },
    },
  });
  if (!count) return { success: false, error: t("errors.itemNotFound") };
  if (count.cancelledAt) {
    return { success: false, error: t("stock.countAlreadyCancelled") };
  }

  // Periods are keyed by the UTC month, the same way `@/lib/reimbursement-periods`
  // builds them — reading the month in local time would put a count taken late
  // on the 31st in the wrong period.
  const period = await prisma.reimbursementPeriod.findUnique({
    where: {
      officeId_year_month: {
        officeId,
        year: count.countedAt.getUTCFullYear(),
        month: count.countedAt.getUTCMonth() + 1,
      },
    },
    select: { id: true, statementsSentAt: true },
  });
  if (period?.statementsSentAt) {
    return { success: false, error: t("stock.countPeriodSettled") };
  }

  // Read above, one atomic batch here. Guards: the count is still live (a
  // count is undone once), and its period, when it exists, still has no
  // statements out.
  const gaps = count.lines.filter((l) => l.delta !== 0);
  try {
    await commitBatch((db) => [
      expectRows(
        db.stockCount.updateMany({
          where: { id: count.id, cancelledAt: null },
          data: { cancelledAt: new Date() },
        }),
        1,
      ),
      ...(period
        ? [
            expectRows(
              db.reimbursementPeriod.updateMany({
                where: { id: period.id, statementsSentAt: null },
                data: { statementsSentAt: null },
              }),
              1,
            ),
          ]
        : []),
      ...gaps.flatMap((l) =>
        stockDeltaOps(db, {
          officeId,
          itemId: l.itemId,
          delta: -l.delta,
          reason: "ADJUSTMENT",
          note: t("stock.countCancelledNote"),
          userId: membership.userId,
        }),
      ),
    ]);
  } catch (error) {
    if (error instanceof BatchConflictError) {
      return { success: false, error: t("stock.countAlreadyCancelled") };
    }
    throw error;
  }

  revalidateShelf(officeId);
  return {
    success: true,
    restored: gaps.reduce((sum, l) => sum + Math.abs(l.delta), 0),
  };
}
