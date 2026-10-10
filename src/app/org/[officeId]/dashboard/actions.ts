"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { commitBatch, prisma, retryOnConflict } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { getTodayDate } from "@/lib/date";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { platform } from "@/platform";
import { resolveItemId } from "@/lib/items";
import { stockAtLeast, stockDeltaOps } from "@/lib/stock";
import { cancelConsumptionEntry } from "@/lib/cancel-consumption";

type ActionResult = { success: true } | { success: false; error: string };

export async function takeACan(
  officeId: string,
  itemId?: string | null,
): Promise<ActionResult> {
  const { session } = await requireMembership(officeId);
  const t = await getTranslations();
  const userId = session.user.id;

  const resolvedItemId = await resolveItemId(officeId, itemId);
  if (!resolvedItemId) {
    return { success: false, error: t("errors.itemNotFound") };
  }

  const result = await retryOnConflict(() => takeOnce(officeId, resolvedItemId, userId, t));
  if (!result.success) return result;

  platform.runInBackground(checkAndAlertLowStock(officeId, resolvedItemId), "low-stock alert");

  revalidatePath(`/org/${officeId}/dashboard`);
  return { success: true };
}

/**
 * Checks the pool, then records the can in one atomic batch. The guard needs
 * the can the check saw to still be there: when the last one went to someone
 * else in between, the batch is rolled back and the check runs again.
 */
async function takeOnce(
  officeId: string,
  resolvedItemId: string,
  userId: string,
  t: Awaited<ReturnType<typeof getTranslations>>,
): Promise<ActionResult> {
  const stock = await prisma.stock.findUnique({
    where: { officeId_itemId: { officeId, itemId: resolvedItemId } },
  });
  if (!stock) {
    return { success: false, error: t("errors.stockNotFound") };
  }

  if (stock.currentQty <= 0) {
    return { success: false, error: t("errors.cannotReduceBelowZero", { current: stock.currentQty, adjustment: -1 }) };
  }

  await commitBatch((db) => [
    stockAtLeast(db, officeId, resolvedItemId, 1),
    db.consumptionEntry.createMany({
      data: [
        {
          officeId,
          userId,
          itemId: resolvedItemId,
          date: getTodayDate(),
          qty: 1,
          source: "MANUAL",
        },
      ],
    }),
    ...stockDeltaOps(db, {
      officeId,
      itemId: resolvedItemId,
      delta: -1,
      reason: "SERVED",
      note: "Self-serve",
      userId,
    }),
  ]);
  return { success: true };
}

export async function cancelConsumption(
  officeId: string,
  consumptionEntryId: string
): Promise<ActionResult> {
  const { session } = await requireMembership(officeId);
  const t = await getTranslations();

  const outcome = await cancelConsumptionEntry({
    officeId,
    userId: session.user.id,
    entryId: consumptionEntryId,
    note: "Consumption cancelled by user",
  });
  if (outcome === "not_found") {
    return { success: false, error: t("errors.consumptionNotFound") };
  }
  if (outcome === "not_yours") {
    return { success: false, error: t("errors.notYourConsumption") };
  }
  if (outcome === "already_cancelled") {
    return { success: false, error: t("errors.alreadyCancelled") };
  }

  revalidatePath(`/org/${officeId}/dashboard`);
  revalidatePath(`/org/${officeId}/request`);
  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/reimbursements`);
  return { success: true };
}
