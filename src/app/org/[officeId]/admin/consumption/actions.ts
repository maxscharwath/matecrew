"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { commitBatch, expectRows, prisma, retryOnConflict } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { checkAndAlertLowStockMany } from "@/lib/stock-alerts";
import { platform } from "@/platform";
import { stockAtLeast, stockDeltaOps } from "@/lib/stock";

type ActionResult = { success: true; count: number } | { success: false; error: string };

type SwapResult =
  | { success: true; from: string; to: string }
  | { success: false; error: string };

interface ConsumptionRow {
  userId: string;
  itemId?: string | null;
  date: string; // ISO date string YYYY-MM-DD
  qty: number;
  deductStock: boolean;
}

type Translate = Awaited<ReturnType<typeof getTranslations>>;

type ResolvedRow = ConsumptionRow & { resolvedItemId: string };

export async function bulkCreateConsumption(
  officeId: string,
  rows: ConsumptionRow[],
): Promise<ActionResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  if (rows.length === 0) {
    return { success: false, error: t("bulkConsumption.noRows") };
  }

  const result = await retryOnConflict(() => recordBulkConsumption(officeId, rows, membership.userId, t));
  if (!result.success) return result;

  revalidatePath(`/org/${officeId}/admin/consumption`);
  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/admin/stock`);
  revalidatePath(`/org/${officeId}/dashboard`);

  return result;
}

/** Resolves each row's item (falling back to the office default), or the error of the first invalid row. */
async function resolveRows(
  officeId: string,
  rows: readonly ConsumptionRow[],
  t: Translate,
): Promise<{ resolved: ResolvedRow[] } | { error: string }> {
  const [memberships, officeItems] = await Promise.all([
    prisma.membership.findMany({ where: { officeId }, select: { userId: true } }),
    prisma.item.findMany({ where: { officeId }, select: { id: true, isDefault: true } }),
  ]);
  const memberIds = new Set(memberships.map((m) => m.userId));
  const itemIds = new Set(officeItems.map((i) => i.id));
  const defaultItemId = officeItems.find((i) => i.isDefault)?.id ?? null;

  const resolved: ResolvedRow[] = [];
  for (const row of rows) {
    if (!memberIds.has(row.userId)) return { error: t("errors.userNotFound") };
    if (row.qty < 1) return { error: t("errors.qtyMustBePositive") };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return { error: t("bulkConsumption.invalidDate") };
    const resolvedItemId = row.itemId ?? defaultItemId;
    if (!resolvedItemId || !itemIds.has(resolvedItemId)) return { error: t("errors.itemNotFound") };
    resolved.push({ ...row, resolvedItemId });
  }
  return { resolved };
}

/**
 * Validates the rows against the current members, items and stock, then
 * records them in one atomic batch. Each item's pool is guarded at the level
 * the check saw: if a take lowers it in between, the batch is rolled back
 * and `retryOnConflict` runs the check again on the fresh level.
 */
async function recordBulkConsumption(
  officeId: string,
  rows: readonly ConsumptionRow[],
  actingUserId: string,
  t: Translate,
): Promise<ActionResult> {
  const resolution = await resolveRows(officeId, rows, t);
  if ("error" in resolution) return { success: false, error: resolution.error };
  const { resolved } = resolution;

  // qty to deduct from stock, per item
  const deductByItem = new Map<string, number>();
  for (const row of resolved) {
    if (row.deductStock) {
      deductByItem.set(row.resolvedItemId, (deductByItem.get(row.resolvedItemId) ?? 0) + row.qty);
    }
  }

  // Check per-item stock sufficiency before writing anything.
  if (deductByItem.size > 0) {
    const stocks = await prisma.stock.findMany({
      where: { officeId, itemId: { in: [...deductByItem.keys()] } },
      select: { itemId: true, currentQty: true },
    });
    const qtyByItem = new Map(stocks.map((s) => [s.itemId, s.currentQty]));
    for (const [itemId, deduct] of deductByItem) {
      const currentQty = qtyByItem.get(itemId) ?? 0;
      if (deduct > currentQty) {
        return {
          success: false,
          error: t("errors.cannotReduceBelowZero", {
            current: currentQty,
            adjustment: -deduct,
          }),
        };
      }
    }
  }

  await commitBatch((db) => [
    ...[...deductByItem.entries()].map(([itemId, deduct]) => stockAtLeast(db, officeId, itemId, deduct)),
    db.consumptionEntry.createMany({
      data: resolved.map((row) => ({
        officeId,
        userId: row.userId,
        itemId: row.resolvedItemId,
        date: new Date(row.date),
        qty: row.qty,
        source: "MANUAL" as const,
      })),
    }),
    ...[...deductByItem.entries()].flatMap(([itemId, deduct]) =>
      stockDeltaOps(db, {
        officeId,
        itemId,
        delta: -deduct,
        reason: "SERVED",
        note: `Bulk consumption (${deduct})`,
        userId: actingUserId,
      }),
    ),
  ]);

  return { success: true, count: rows.length };
}

/**
 * Re-points one recorded consumption at a different item — "she actually drank
 * a Ginger, not a Classic".
 *
 * The correction is written as the two physical facts it stands for: the can
 * that was never taken goes back on the shelf (UNSERVED) and the one that was
 * really drunk leaves it (SERVED). Reusing those two reasons instead of
 * inventing a "swap" one keeps every downstream reader correct for free — the
 * reorder prediction only counts SERVED movements, so the drinking rate follows
 * the item that was actually drunk.
 *
 * Costing needs nothing here: the ledger replays consumption entries, so the
 * entry is priced as the new item from its own date onwards, and the period's
 * settlement follows.
 */
export async function swapConsumptionItem(
  officeId: string,
  entryId: string,
  newItemId: string,
): Promise<SwapResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const result = await retryOnConflict(() => swapOnce(officeId, entryId, newItemId, membership.userId, t));
  if (!result.success) return result;

  // Both pools moved: the new item may have dipped under the threshold, and the
  // old one may have recovered above it, which re-arms its alert.
  platform.runInBackground(checkAndAlertLowStockMany(officeId, [result.fromItemId, newItemId]), "low-stock alert");

  revalidatePath(`/org/${officeId}/admin/consumption`);
  revalidatePath(`/org/${officeId}/admin/stock`);
  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/reimbursements`);
  revalidatePath(`/org/${officeId}/dashboard`);
  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/stats`);

  return { success: true, from: result.from, to: result.to };
}

/**
 * Reads the entry, the target item and its pool, then commits the swap in one
 * atomic batch. Guards: the entry is still live and still on its old item,
 * and the target pool still has the cans the check saw; otherwise the batch
 * is rolled back and `retryOnConflict` validates again on fresh data.
 */
async function swapOnce(
  officeId: string,
  entryId: string,
  newItemId: string,
  actingUserId: string,
  t: Translate,
): Promise<(Extract<SwapResult, { success: true }> & { fromItemId: string }) | Extract<SwapResult, { success: false }>> {
  const entry = await prisma.consumptionEntry.findUnique({
    where: { id: entryId },
    include: { item: { select: { name: true } } },
  });
  if (entry?.officeId !== officeId) {
    return { success: false, error: t("errors.consumptionNotFound") };
  }
  // A cancelled entry's can is already back on the shelf and it bills nobody,
  // so there is nothing to re-point.
  if (entry.cancelledAt) {
    return { success: false, error: t("errors.alreadyCancelled") };
  }
  if (entry.itemId === newItemId) {
    return { success: false, error: t("bulkConsumption.swapSameItem") };
  }

  const newItem = await prisma.item.findFirst({
    where: { id: newItemId, officeId },
    select: { id: true, name: true },
  });
  if (!newItem) {
    return { success: false, error: t("errors.itemNotFound") };
  }

  // The cans the swap needs have to be on the shelf: the entry's own can goes
  // back to the *old* item, which cannot pay for the new one. A count too low
  // to absorb the swap is a count that was already wrong — an adjustment or a
  // stock count fixes that, rather than letting the pool go negative.
  const target = await prisma.stock.findUnique({
    where: { officeId_itemId: { officeId, itemId: newItemId } },
    select: { currentQty: true },
  });
  const available = target?.currentQty ?? 0;
  if (available < entry.qty) {
    return {
      success: false,
      error: t("errors.cannotReduceBelowZero", {
        current: available,
        adjustment: -entry.qty,
      }),
    };
  }

  // A served daily request carries its own itemId, and `markUnserved` pairs it
  // back to a consumption entry by matching that id. Leaving the order pointing
  // at the old item would strand the pair: undoing the serve later would credit
  // the old item and miss this entry entirely. Requests are served one can at a
  // time, so one order matches this entry.
  const order =
    entry.source === "DAILY_REQUEST"
      ? await prisma.dailyRequest.findFirst({
          where: {
            officeId,
            userId: entry.userId,
            itemId: entry.itemId,
            date: entry.date,
            status: "SERVED",
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        })
      : null;

  await commitBatch((db) => [
    expectRows(
      db.consumptionEntry.updateMany({
        where: { id: entryId, itemId: entry.itemId, cancelledAt: null },
        data: { itemId: newItemId },
      }),
      1,
    ),
    stockAtLeast(db, officeId, newItemId, entry.qty),
    ...(order
      ? [
          db.dailyRequest.updateMany({
            where: { id: order.id },
            data: { itemId: newItemId },
          }),
        ]
      : []),
    ...stockDeltaOps(db, {
      officeId,
      itemId: entry.itemId,
      delta: entry.qty,
      reason: "UNSERVED",
      note: `Swapped to ${newItem.name}`,
      userId: actingUserId,
    }),
    ...stockDeltaOps(db, {
      officeId,
      itemId: newItemId,
      delta: -entry.qty,
      reason: "SERVED",
      note: `Swapped from ${entry.item.name}`,
      userId: actingUserId,
    }),
  ]);

  return { success: true, from: entry.item.name, to: newItem.name, fromItemId: entry.itemId };
}
