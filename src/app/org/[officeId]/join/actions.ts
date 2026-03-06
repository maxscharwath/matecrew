"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-utils";
import { getTranslations } from "next-intl/server";

type ActionResult = { success: true } | { success: false; error: string };

export async function createJoinRequest(
  officeId: string
): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getTranslations();

  const office = await prisma.office.findUnique({
    where: { id: officeId },
    select: { id: true },
  });

  if (!office) {
    return { success: false, error: t("errors.officeNotFound") };
  }

  // Check if already a member
  const existing = await prisma.membership.findUnique({
    where: { userId_officeId: { userId: session.user.id, officeId } },
  });

  if (existing) {
    return { success: false, error: t("errors.alreadyMember") };
  }

  // Check for existing pending request
  const existingRequest = await prisma.joinRequest.findUnique({
    where: { userId_officeId: { userId: session.user.id, officeId } },
  });

  if (existingRequest?.status === "PENDING") {
    return { success: false, error: t("errors.joinRequestAlreadyPending") };
  }

  // Upsert: if rejected, allow re-requesting
  await prisma.joinRequest.upsert({
    where: { userId_officeId: { userId: session.user.id, officeId } },
    create: { userId: session.user.id, officeId },
    update: { status: "PENDING", createdAt: new Date() },
  });

  revalidatePath(`/org/${officeId}`);
  return { success: true };
}
