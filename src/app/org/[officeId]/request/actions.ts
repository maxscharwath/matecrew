"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { isSessionOpen } from "@/lib/session-utils";

type ActionResult = { success: true } | { success: false; error: string };

export async function submitDailyRequest(
  officeId: string,
  date: Date,
  mateSessionId: string | null,
): Promise<ActionResult> {
  const { session } = await requireMembership(officeId);
  const t = await getTranslations();
  const userId = session.user.id;

  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
    select: { timezone: true },
  });

  // Validate session is open if provided
  if (mateSessionId) {
    const mateSession = await prisma.mateSession.findUnique({
      where: { id: mateSessionId },
    });
    if (!mateSession || mateSession.officeId !== officeId) {
      return { success: false, error: t('errors.sessionNotFound') };
    }
    if (!isSessionOpen(mateSession, office.timezone)) {
      return {
        success: false,
        error: t('errors.requestsClosed', { time: mateSession.cutoffTime }),
      };
    }
  }

  // Check if already requested for this session
  const existing = await prisma.dailyRequest.findFirst({
    where: { date, officeId, userId, mateSessionId },
  });

  if (existing) {
    return { success: true }; // Already requested — idempotent
  }

  await prisma.dailyRequest.create({
    data: {
      date,
      officeId,
      userId,
      mateSessionId,
      status: "REQUESTED",
    },
  });

  revalidatePath(`/org/${officeId}/request`);
  revalidatePath(`/org/${officeId}/runner`);
  return { success: true };
}

export async function cancelDailyRequest(
  officeId: string,
  requestId: string
): Promise<ActionResult> {
  const { session } = await requireMembership(officeId);
  const t = await getTranslations();

  const request = await prisma.dailyRequest.findUnique({
    where: { id: requestId },
  });

  if (!request) {
    return { success: false, error: t('errors.requestNotFound') };
  }

  if (request.userId !== session.user.id) {
    return { success: false, error: t('errors.notYourRequest') };
  }

  if (request.status !== "REQUESTED") {
    return { success: false, error: t('errors.cannotCancelServed') };
  }

  await prisma.dailyRequest.delete({ where: { id: requestId } });

  revalidatePath(`/org/${officeId}/request`);
  revalidatePath(`/org/${officeId}/runner`);
  return { success: true };
}
