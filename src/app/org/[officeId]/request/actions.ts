"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { createMateRequest } from "@/lib/mate-request";

type ActionResult = { success: true } | { success: false; error: string };

export async function submitDailyRequest(
  officeId: string,
  date: Date,
  mateSessionId: string | null,
): Promise<ActionResult> {
  const { session } = await requireMembership(officeId);
  const t = await getTranslations();

  const result = await createMateRequest({
    userId: session.user.id,
    officeId,
    mateSessionId,
    date,
  });

  switch (result.kind) {
    case "not_member":
      return { success: false, error: t('errors.notYourRequest') };
    case "session_not_found":
      return { success: false, error: t('errors.sessionNotFound') };
    case "closed":
      return {
        success: false,
        error: t('errors.requestsClosed', { time: result.cutoffTime }),
      };
    case "created":
    case "already_registered":
      revalidatePath(`/org/${officeId}/request`);
      revalidatePath(`/org/${officeId}/runner`);
      return { success: true };
  }
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
