"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";

type ActionResult = { success: true } | { success: false; error: string };

export async function submitDailyRequest(
  officeId: string,
  date: Date
): Promise<ActionResult> {
  const { session } = await requireMembership(officeId);
  const userId = session.user.id;

  await prisma.dailyRequest.upsert({
    where: {
      date_officeId_userId: { date, officeId, userId },
    },
    create: {
      date,
      officeId,
      userId,
      status: "REQUESTED",
    },
    update: {},
  });

  revalidatePath(`/org/${officeId}/request`);
  return { success: true };
}

export async function cancelDailyRequest(
  officeId: string,
  requestId: string
): Promise<ActionResult> {
  const { session } = await requireMembership(officeId);

  const request = await prisma.dailyRequest.findUnique({
    where: { id: requestId },
  });

  if (!request) {
    return { success: false, error: "Request not found." };
  }

  if (request.userId !== session.user.id) {
    return { success: false, error: "Not your request." };
  }

  if (request.status !== "REQUESTED") {
    return { success: false, error: "Cannot cancel a served request." };
  }

  await prisma.dailyRequest.delete({ where: { id: requestId } });

  revalidatePath(`/org/${officeId}/request`);
  return { success: true };
}
