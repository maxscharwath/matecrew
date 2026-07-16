"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { serveSession } from "@/lib/serve-session";
import { stockDeltaOps } from "@/lib/stock";
import { refreshSlackSessionMessage } from "@/lib/notifications";

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

  await prisma.$transaction([
    prisma.dailyRequest.update({
      where: { id: requestId },
      data: { status: "SERVED" },
    }),
    prisma.consumptionEntry.create({
      data: {
        officeId,
        userId: request.userId,
        itemId: request.itemId,
        date: request.date,
        qty: 1,
        source: "DAILY_REQUEST",
      },
    }),
    ...stockDeltaOps({
      officeId,
      itemId: request.itemId,
      delta: -1,
      reason: "SERVED",
      userId: membership.userId,
    }),
  ]);

  checkAndAlertLowStock(officeId, request.itemId).catch(() => {});

  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/request`);
  return { success: true };
}

export async function markCancelled(
  officeId: string,
  requestId: string,
): Promise<ActionResult> {
  await requireMembership(officeId);
  const t = await getTranslations();

  const request = await prisma.dailyRequest.findUnique({ where: { id: requestId } });
  if (request?.officeId !== officeId) {
    return { success: false, error: t('errors.requestNotFound') };
  }
  if (request.status === "SERVED") {
    return { success: false, error: t('errors.cannotCancelServed') };
  }

  await prisma.dailyRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });

  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/request`);
  return { success: true };
}

// Unlike cancelDailyRequest (self-service, blocked once the session closes),
// this lets whoever runs the prep screen drop a request even after the cutoff.
export async function deleteRequest(
  officeId: string,
  requestId: string,
): Promise<ActionResult> {
  await requireMembership(officeId);
  const t = await getTranslations();

  const request = await prisma.dailyRequest.findUnique({ where: { id: requestId } });
  if (request?.officeId !== officeId) {
    return { success: false, error: t('errors.requestNotFound') };
  }
  if (request.status === "SERVED") {
    return { success: false, error: t('errors.cannotCancelServed') };
  }

  await prisma.dailyRequest.delete({ where: { id: requestId } });

  await refreshSlackSessionMessage({
    officeId,
    mateSessionId: request.mateSessionId,
    date: request.date,
  });

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

  await prisma.$transaction([
    prisma.dailyRequest.update({
      where: { id: requestId },
      data: { status: "REQUESTED" },
    }),
    prisma.consumptionEntry.deleteMany({
      where: {
        officeId,
        userId: request.userId,
        itemId: request.itemId,
        date: request.date,
        source: "DAILY_REQUEST",
      },
    }),
    ...stockDeltaOps({
      officeId,
      itemId: request.itemId,
      delta: 1,
      reason: "UNSERVED",
      userId: membership.userId,
    }),
  ]);

  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/request`);
  return { success: true };
}

export async function markAllServed(
  officeId: string,
  mateSessionId: string | null,
  date: Date,
): Promise<ActionResult> {
  const { membership } = await requireMembership(officeId);
  const t = await getTranslations();

  const result = await serveSession({
    officeId,
    mateSessionId,
    date,
    actingUserId: membership.userId,
  });

  if (result.kind === "empty") {
    return { success: false, error: t('errors.noPendingRequests') };
  }

  revalidatePath(`/org/${officeId}/runner`);
  revalidatePath(`/org/${officeId}/request`);
  return { success: true };
}
