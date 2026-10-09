import { prisma } from "@/lib/prisma";
import { getDateInTimezone } from "@/lib/date";
import { stockDeltaOps } from "@/lib/stock";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { normalizeBadgeUid } from "@/lib/device/codes";
import type { AuthenticatedDevice } from "@/lib/device/auth";
import type { DeviceTake, TakesResponse } from "@/lib/device/contract";

type Outcome = { consumptionEntryId: string | null; rejectedReason: string | null };

/**
 * Applies a terminal's queued takes in order. Each take is recorded once in
 * `DeviceTake`, applied or rejected, so a resent queue changes nothing and the
 * terminal can drop every id it gets back in `done`.
 */
export async function applyTakes(
  device: AuthenticatedDevice,
  takes: DeviceTake[],
): Promise<TakesResponse> {
  const done: string[] = [];
  const rejected: TakesResponse["rejected"] = [];
  const touchedItems = new Set<string>();

  for (const take of takes) {
    const known = await prisma.deviceTake.findUnique({
      where: { deviceId_takeId: { deviceId: device.id, takeId: take.id } },
      select: { rejectedReason: true },
    });
    if (!known) {
      const outcome = await applyTake(device, take);
      await prisma.deviceTake.create({
        data: {
          deviceId: device.id,
          takeId: take.id,
          action: take.action,
          badgeUid: take.badgeUid,
          itemId: take.itemId,
          takenAt: new Date(take.at),
          ...outcome,
        },
      });
      if (outcome.rejectedReason === null && take.itemId) touchedItems.add(take.itemId);
      if (outcome.rejectedReason) rejected.push({ id: take.id, reason: outcome.rejectedReason });
    } else if (known.rejectedReason) {
      rejected.push({ id: take.id, reason: known.rejectedReason });
    }
    done.push(take.id);
  }

  for (const itemId of touchedItems) {
    checkAndAlertLowStock(device.officeId, itemId).catch(() => {});
  }
  return { done, rejected };
}

async function applyTake(device: AuthenticatedDevice, take: DeviceTake): Promise<Outcome> {
  const reject = (reason: string): Outcome => ({ consumptionEntryId: null, rejectedReason: reason });
  const officeId = device.officeId;

  const uid = normalizeBadgeUid(take.badgeUid);
  if (!uid) return reject("invalid_badge");
  const badge = await prisma.badge.findUnique({
    where: { officeId_uid: { officeId, uid } },
    select: { userId: true },
  });
  if (!badge?.userId) {
    await recordBadges(officeId, [uid]);
    return reject("unknown_badge");
  }
  const userId = badge.userId;

  if (!take.itemId) return reject("no_item");
  const item = await prisma.item.findFirst({ where: { id: take.itemId, officeId }, select: { id: true } });
  if (!item) return reject("unknown_item");

  const at = new Date(take.at);
  const date = getDateInTimezone(at, device.office.timezone);
  const note = `Terminal ${device.name}`;

  if (take.action === "TAKE") {
    // The can is already out of the fridge: record it even if the books say
    // the stock is empty, so a count later shows the gap instead of hiding it.
    const [entry] = await prisma.$transaction([
      prisma.consumptionEntry.create({
        data: { officeId, userId, itemId: item.id, date, qty: 1, source: "DEVICE", deviceId: device.id },
      }),
      ...stockDeltaOps({ officeId, itemId: item.id, delta: -1, reason: "SERVED", note, userId }),
    ]);
    return { consumptionEntryId: entry.id, rejectedReason: null };
  }

  const latest = await prisma.consumptionEntry.findFirst({
    where: { officeId, userId, itemId: item.id, date, cancelledAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return reject("nothing_to_return");
  await prisma.$transaction([
    prisma.consumptionEntry.update({ where: { id: latest.id }, data: { cancelledAt: new Date() } }),
    ...stockDeltaOps({ officeId, itemId: item.id, delta: 1, reason: "UNSERVED", note, userId }),
  ]);
  return { consumptionEntryId: latest.id, rejectedReason: null };
}

/** Remembers badges a terminal saw so an admin can give them to members. */
export async function recordBadges(officeId: string, uids: string[]) {
  const now = new Date();
  for (const uid of uids) {
    await prisma.badge.upsert({
      where: { officeId_uid: { officeId, uid } },
      create: { officeId, uid },
      update: { lastSeenAt: now },
    });
  }
}
