"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { getTodayDate } from "@/lib/date";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";

type ActionResult = { success: true } | { success: false; error: string };

export async function markServed(
  officeId: string,
  requestId: string
): Promise<ActionResult> {
  const { membership } = await requireMembership(officeId);
  const t = await getTranslations();

  const request = await prisma.dailyRequest.findUnique({
    where: { id: requestId },
  });

  if (request?.officeId !== officeId) {
    return { success: false, error: t('errors.requestNotFound') };
  }

  if (request.status === "SERVED") {
    return { success: false, error: t('errors.alreadyServed') };
  }

  const stock = await prisma.stock.findUnique({
    where: { officeId },
  });

  const newQty = (stock?.currentQty ?? 0) - 1;

  await prisma.$transaction([
    prisma.dailyRequest.update({
      where: { id: requestId },
      data: { status: "SERVED" },
    }),
    prisma.consumptionEntry.create({
      data: {
        officeId,
        userId: request.userId,
        date: request.date,
        qty: 1,
        source: "DAILY_REQUEST",
      },
    }),
    prisma.stockMovement.create({
      data: {
        officeId,
        delta: -1,
        reason: "SERVED",
        userId: membership.userId,
      },
    }),
    prisma.stock.update({
      where: { officeId },
      data: { currentQty: newQty },
    }),
  ]);

  checkAndAlertLowStock(officeId).catch(() => {});

  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/request`);
  return { success: true };
}

export async function markUnserved(
  officeId: string,
  requestId: string
): Promise<ActionResult> {
  const { membership } = await requireMembership(officeId);
  const t = await getTranslations();

  const request = await prisma.dailyRequest.findUnique({
    where: { id: requestId },
  });

  if (request?.officeId !== officeId) {
    return { success: false, error: t('errors.requestNotFound') };
  }

  if (request.status !== "SERVED") {
    return { success: false, error: t('errors.notYetServed') };
  }

  const stock = await prisma.stock.findUnique({
    where: { officeId },
  });

  const newQty = (stock?.currentQty ?? 0) + 1;
  const today = getTodayDate();

  await prisma.$transaction([
    prisma.dailyRequest.update({
      where: { id: requestId },
      data: { status: "REQUESTED" },
    }),
    prisma.consumptionEntry.deleteMany({
      where: {
        officeId,
        userId: request.userId,
        date: today,
        source: "DAILY_REQUEST",
      },
    }),
    prisma.stockMovement.create({
      data: {
        officeId,
        delta: 1,
        reason: "UNSERVED",
        userId: membership.userId,
      },
    }),
    prisma.stock.update({
      where: { officeId },
      data: { currentQty: newQty },
    }),
  ]);

  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/request`);
  return { success: true };
}

export async function markAllServed(
  officeId: string,
  mateSessionId: string | null,
): Promise<ActionResult> {
  const { membership } = await requireMembership(officeId);
  const t = await getTranslations();

  const today = getTodayDate();
  const pending = await prisma.dailyRequest.findMany({
    where: { officeId, date: today, status: "REQUESTED", mateSessionId },
  });

  if (pending.length === 0) {
    return { success: false, error: t('errors.noPendingRequests') };
  }

  const stock = await prisma.stock.findUnique({ where: { officeId } });
  const newQty = (stock?.currentQty ?? 0) - pending.length;

  await prisma.$transaction([
    prisma.dailyRequest.updateMany({
      where: { id: { in: pending.map((r) => r.id) } },
      data: { status: "SERVED" },
    }),
    ...pending.map((r) =>
      prisma.consumptionEntry.create({
        data: {
          officeId,
          userId: r.userId,
          date: r.date,
          qty: 1,
          source: "DAILY_REQUEST",
        },
      }),
    ),
    prisma.stockMovement.create({
      data: {
        officeId,
        delta: -pending.length,
        reason: "SERVED",
        note: `Batch serve (${pending.length})`,
        userId: membership.userId,
      },
    }),
    prisma.stock.update({
      where: { officeId },
      data: { currentQty: newQty },
    }),
  ]);

  checkAndAlertLowStock(officeId).catch(() => {});

  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/request`);
  return { success: true };
}
