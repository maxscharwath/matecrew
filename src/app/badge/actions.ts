"use server";

import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-utils";
import { verifyClaim, type ClaimParams } from "@/lib/device/badge-claim";

type ClaimResult = { success: true; deviceName: string } | { success: false; error: string };

/**
 * Links the badge a terminal just read to the signed-in member. The terminal
 * is told to sync at once, so the very next tap of the badge is recognised.
 */
export async function claimBadge(params: ClaimParams): Promise<ClaimResult> {
  const session = await requireSession();
  const t = await getTranslations("badgeClaim");
  const claim = await verifyClaim(params);
  if (!claim.ok) return { success: false, error: t(claim.reason === "expired" ? "expiredTitle" : "invalidTitle") };

  const officeId = claim.device.office.id;
  const member = await prisma.membership.findUnique({
    where: { userId_officeId: { userId: session.user.id, officeId } },
    select: { id: true },
  });
  if (!member) return { success: false, error: t("notMember", { office: claim.device.office.name }) };

  const existing = await prisma.badge.findUnique({
    where: { officeId_uid: { officeId, uid: claim.uid } },
    select: { userId: true },
  });
  if (existing?.userId && existing.userId !== session.user.id) return { success: false, error: t("takenTitle") };

  const now = new Date();
  await prisma.$transaction([
    prisma.badge.upsert({
      where: { officeId_uid: { officeId, uid: claim.uid } },
      create: { officeId, uid: claim.uid, userId: session.user.id, firstSeenAt: now, lastSeenAt: now },
      update: { userId: session.user.id, lastSeenAt: now },
    }),
    prisma.deviceCommand.create({ data: { deviceId: claim.device.id, kind: "SYNC", sentById: session.user.id } }),
  ]);
  return { success: true, deviceName: claim.device.name };
}
