import { prisma } from "@/lib/prisma";
import { getTodayDate } from "@/lib/date";
import { serveSession } from "@/lib/serve-session";
import { normalizeBadgeUid } from "@/lib/device/codes";
import { recordBadges } from "@/lib/device/takes";
import { AVATAR_SIDE, avatarPicture } from "@/lib/device/avatar";
import type { AuthenticatedDevice } from "@/lib/device/auth";
import type { ServeRequest, ServeResponse } from "@/lib/device/contract";

/**
 * "Servi" on a terminal's preparation screen: the runner's badge closes the session as the runner
 * page does, every pending order served, consumed and out of stock. Serving twice is harmless:
 * the second time finds nothing pending and serves 0. The answer carries the runner's avatar for
 * the screen that thanks them.
 */
export async function serveFromDevice(device: AuthenticatedDevice, request: ServeRequest): Promise<ServeResponse> {
  const uid = normalizeBadgeUid(request.badgeUid);
  if (!uid) return { served: 0, reason: "invalid_badge", avatar: null };
  const badge = await prisma.badge.findUnique({
    where: { officeId_uid: { officeId: device.officeId, uid } },
    select: { userId: true, user: { select: { image: true } } },
  });
  if (!badge?.userId) {
    await recordBadges(device.officeId, [uid]);
    return { served: 0, reason: "unknown_badge", avatar: null };
  }
  // The day the preparation screen showed: requests are dated like this (see device/state.ts).
  const [result, avatar] = await Promise.all([
    serveSession({
      officeId: device.officeId,
      mateSessionId: request.sessionId,
      date: getTodayDate(),
      actingUserId: badge.userId,
      movementNote: `Terminal ${device.name}`,
    }),
    avatarPicture(badge.userId, badge.user?.image, AVATAR_SIDE.served),
  ]);
  return { served: result.kind === "ok" ? result.servedCount : 0, reason: null, avatar };
}
