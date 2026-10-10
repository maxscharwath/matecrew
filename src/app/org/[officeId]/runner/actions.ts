"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { BatchConflictError, commitBatch, expectRows, prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { platform } from "@/platform";
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

  // Read above, one atomic batch here. The guard only flips a request that is
  // still unserved, so a double click cannot consume and destock twice.
  try {
    await commitBatch((db) => [
      expectRows(
        db.dailyRequest.updateMany({
          where: { id: requestId, status: request.status },
          data: { status: "SERVED" },
        }),
        1,
      ),
      db.consumptionEntry.createMany({
        data: [
          {
            officeId,
            userId: request.userId,
            itemId: request.itemId,
            date: request.date,
            qty: 1,
            source: "DAILY_REQUEST",
          },
        ],
      }),
      ...stockDeltaOps(db, {
        officeId,
        itemId: request.itemId,
        delta: -1,
        reason: "SERVED",
        userId: membership.userId,
      }),
    ]);
  } catch (error) {
    if (error instanceof BatchConflictError) return { success: false, error: t('errors.alreadyServed') };
    throw error;
  }

  platform.runInBackground(checkAndAlertLowStock(officeId, request.itemId), "low-stock alert");

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

  // Read above, one atomic batch here. The guard only reverts a request that
  // is still served, so a double click cannot restock twice.
  try {
    await commitBatch((db) => [
      expectRows(
        db.dailyRequest.updateMany({
          where: { id: requestId, status: "SERVED" },
          data: { status: "REQUESTED" },
        }),
        1,
      ),
      db.consumptionEntry.deleteMany({
        where: {
          officeId,
          userId: request.userId,
          itemId: request.itemId,
          date: request.date,
          source: "DAILY_REQUEST",
        },
      }),
      ...stockDeltaOps(db, {
        officeId,
        itemId: request.itemId,
        delta: 1,
        reason: "UNSERVED",
        userId: membership.userId,
      }),
    ]);
  } catch (error) {
    if (error instanceof BatchConflictError) return { success: false, error: t('errors.notYetServed') };
    throw error;
  }

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
