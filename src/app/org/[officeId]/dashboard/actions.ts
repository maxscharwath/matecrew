"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { getTodayDate } from "@/lib/date";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";

type ActionResult = { success: true } | { success: false; error: string };

export async function takeACan(officeId: string): Promise<ActionResult> {
  const { session } = await requireMembership(officeId);
  const t = await getTranslations();
  const userId = session.user.id;
  const today = getTodayDate();

  const stock = await prisma.stock.findUnique({ where: { officeId } });
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
        date: today,
        qty: 1,
        source: "MANUAL",
      },
    }),
    prisma.stockMovement.create({
      data: {
        officeId,
        delta: -1,
        reason: "SERVED",
        note: "Self-serve",
        userId,
      },
    }),
    prisma.stock.update({
      where: { officeId },
      data: { currentQty: stock.currentQty - 1 },
    }),
  ]);

  checkAndAlertLowStock(officeId).catch(() => {});

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

  const stock = await prisma.stock.findUnique({ where: { officeId } });
  const newQty = (stock?.currentQty ?? 0) + entry.qty;

  await prisma.$transaction([
    prisma.consumptionEntry.update({
      where: { id: consumptionEntryId },
      data: { cancelledAt: new Date() },
    }),
    prisma.stockMovement.create({
      data: {
        officeId,
        delta: entry.qty,
        reason: "UNSERVED",
        note: "Consumption cancelled by user",
        userId: session.user.id,
      },
    }),
    prisma.stock.update({
      where: { officeId },
      data: { currentQty: newQty },
    }),
  ]);

  revalidatePath(`/org/${officeId}/dashboard`);
  revalidatePath(`/org/${officeId}/request`);
  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/reimbursements`);
  return { success: true };
}
