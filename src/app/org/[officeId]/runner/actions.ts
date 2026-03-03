"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getTodayDate } from "@/lib/date";

type ActionResult = { success: true } | { success: false; error: string };

export async function markServed(
  officeId: string,
  requestId: string
): Promise<ActionResult> {
  const { membership } = await requireOrgRoles(officeId, "RUNNER", "ADMIN");

  const request = await prisma.dailyRequest.findUnique({
    where: { id: requestId },
  });

  if (!request || request.officeId !== officeId) {
    return { success: false, error: "Request not found." };
  }

  if (request.status === "SERVED") {
    return { success: false, error: "Already served." };
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

  revalidatePath(`/org/${officeId}/runner`);
  return { success: true };
}

export async function markUnserved(
  officeId: string,
  requestId: string
): Promise<ActionResult> {
  const { membership } = await requireOrgRoles(officeId, "RUNNER", "ADMIN");

  const request = await prisma.dailyRequest.findUnique({
    where: { id: requestId },
  });

  if (!request || request.officeId !== officeId) {
    return { success: false, error: "Request not found." };
  }

  if (request.status !== "SERVED") {
    return { success: false, error: "Not yet served." };
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
  return { success: true };
}
