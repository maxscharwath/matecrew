"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { getTodayDate } from "@/lib/date";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { resolveItemId } from "@/lib/items";
import { stockDeltaOps } from "@/lib/stock";

type ActionResult = { success: true } | { success: false; error: string };

export async function takeACan(
  officeId: string,
  itemId?: string | null,
): Promise<ActionResult> {
  const { session } = await requireMembership(officeId);
  const t = await getTranslations();
  const userId = session.user.id;
  const today = getTodayDate();

  const resolvedItemId = await resolveItemId(officeId, itemId);
  if (!resolvedItemId) {
    return { success: false, error: t("errors.itemNotFound") };
  }

  const stock = await prisma.stock.findUnique({
    where: { officeId_itemId: { officeId, itemId: resolvedItemId } },
  });
  if (!stock) {
    return { success: false, error: t("errors.stockNotFound") };
  }

  if (stock.currentQty <= 0) {
    return { success: false, error: t("errors.cannotReduceBelowZero", { current: stock.currentQty, adjustment: -1 }) };
  }

  await prisma.$transaction([
    prisma.consumptionEntry.create({
      data: {
        officeId,
        userId,
        itemId: resolvedItemId,
        date: today,
        qty: 1,
        source: "MANUAL",
      },
    }),
    ...stockDeltaOps({
      officeId,
      itemId: resolvedItemId,
      delta: -1,
      reason: "SERVED",
      note: "Self-serve",
      userId,
    }),
  ]);

  checkAndAlertLowStock(officeId, resolvedItemId).catch(() => {});

  revalidatePath(`/org/${officeId}/dashboard`);
  return { success: true };
}

export async function cancelConsumption(
  officeId: string,
  consumptionEntryId: string
): Promise<ActionResult> {
  const { session } = await requireMembership(officeId);
  const t = await getTranslations();

  const entry = await prisma.consumptionEntry.findUnique({
    where: { id: consumptionEntryId },
  });

  if (entry?.officeId !== officeId) {
    return { success: false, error: t("errors.consumptionNotFound") };
  }

  if (entry.userId !== session.user.id) {
    return { success: false, error: t("errors.notYourConsumption") };
  }

  if (entry.cancelledAt) {
    return { success: false, error: t("errors.alreadyCancelled") };
  }

  await prisma.$transaction([
    prisma.consumptionEntry.update({
      where: { id: consumptionEntryId },
      data: { cancelledAt: new Date() },
    }),
    ...stockDeltaOps({
      officeId,
      itemId: entry.itemId,
      delta: entry.qty,
      reason: "UNSERVED",
      note: "Consumption cancelled by user",
      userId: session.user.id,
    }),
  ]);

  revalidatePath(`/org/${officeId}/dashboard`);
  revalidatePath(`/org/${officeId}/request`);
  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/reimbursements`);
  return { success: true };
}
