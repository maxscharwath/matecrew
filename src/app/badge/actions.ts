"use server";

import { getTranslations } from "next-intl/server";
import { commitBatch, expectRows, prisma, retryOnConflict } from "@/lib/prisma";
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

  const linked = await retryOnConflict(() => linkBadge(officeId, claim.uid, session.user.id, claim.device.id));
  if (!linked) return { success: false, error: t("takenTitle") };
  return { success: true, deviceName: claim.device.name };
}

/**
 * Gives the badge to the member unless someone else holds it, and tells the
 * terminal to sync, in one atomic batch. The guard only takes the badge over
 * from the holder that was read (nobody, or this member); a badge seen for the
 * first time is created, and a concurrent creation is a unique-key conflict.
 * Either way the loser reads again. Resolves to false when the badge is taken.
 */
async function linkBadge(officeId: string, uid: string, userId: string, deviceId: string): Promise<boolean> {
  const existing = await prisma.badge.findUnique({
    where: { officeId_uid: { officeId, uid } },
    select: { userId: true },
  });
  if (existing?.userId && existing.userId !== userId) return false;

  const now = new Date();
  await commitBatch((db) => [
    existing
      ? expectRows(
          db.badge.updateMany({
            where: { officeId, uid, userId: existing.userId },
            data: { userId, lastSeenAt: now },
          }),
          1,
        )
      : db.badge.createMany({ data: [{ officeId, uid, userId, firstSeenAt: now, lastSeenAt: now }] }),
    db.deviceCommand.createMany({ data: [{ deviceId, kind: "SYNC", sentById: userId }] }),
  ]);
  return true;
}
