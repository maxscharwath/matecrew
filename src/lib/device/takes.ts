import { BatchConflictError, commitBatch, newId, prisma } from "@/lib/prisma";
import { getDateInTimezone } from "@/lib/date";
import { stockDeltaOps } from "@/lib/stock";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { platform, type BatchClient } from "@/platform";
import { normalizeBadgeUid } from "@/lib/device/codes";
import type { AuthenticatedDevice } from "@/lib/device/auth";
import type { DeviceTake, TakesResponse } from "@/lib/device/contract";

type Outcome = { consumptionEntryId: string | null; rejectedReason: string | null };

/** What a take turns into: a consumption by a member, or the reason it is refused. */
type Decision =
  | { readonly kind: "apply"; readonly userId: string; readonly itemId: string; readonly date: Date }
  | { readonly kind: "reject"; readonly reason: string };

/** `step` on each item, one after the other: the next starts once the previous one is done. */
function inSequence<T>(items: readonly T[], step: (item: T) => Promise<void>): Promise<void> {
  return items.reduce<Promise<void>>((previous, item) => previous.then(() => step(item)), Promise.resolve());
}

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

  await inSequence(takes, async (take) => {
    const known = await knownTake(device.id, take.id);
    const outcome = known ?? (await recordTake(device, take));
    if (!known) {
      await markBadgeSeen(device.officeId, take.badgeUid, new Date(take.at));
      if (outcome.rejectedReason === null && take.itemId) touchedItems.add(take.itemId);
    }
    if (outcome.rejectedReason) rejected.push({ id: take.id, reason: outcome.rejectedReason });
    done.push(take.id);
  });

  for (const itemId of touchedItems) {
    platform.runInBackground(checkAndAlertLowStock(device.officeId, itemId), "low-stock alert");
  }
  return { done, rejected };
}

function knownTake(deviceId: string, takeId: string): Promise<Outcome | null> {
  return prisma.deviceTake.findUnique({
    where: { deviceId_takeId: { deviceId, takeId } },
    select: { consumptionEntryId: true, rejectedReason: true },
  });
}

/**
 * Decides the take, then writes its `DeviceTake` row with its effects in one
 * atomic batch: the consumption and the stock movement land together with
 * the record that the take was applied, or not at all. The row's unique
 * (deviceId, takeId) is the guard: when the same take, resent, is being
 * applied by a concurrent request, one batch fails on it and nothing of it is
 * written, so a can is never billed twice. The loser reports what the winner
 * recorded.
 */
async function recordTake(device: AuthenticatedDevice, take: DeviceTake): Promise<Outcome> {
  const decision = await decideTake(device, take);
  const takeRow = {
    deviceId: device.id,
    takeId: take.id,
    action: "TAKE" as const,
    badgeUid: take.badgeUid,
    itemId: take.itemId,
    takenAt: new Date(take.at),
  };
  const outcome: Outcome =
    decision.kind === "apply"
      ? { consumptionEntryId: newId(), rejectedReason: null }
      : { consumptionEntryId: null, rejectedReason: decision.reason };

  try {
    await commitBatch((db) => [
      ...(decision.kind === "apply" && outcome.consumptionEntryId
        ? consumptionWrites(db, device, decision, outcome.consumptionEntryId)
        : []),
      db.deviceTake.createMany({ data: [{ ...takeRow, ...outcome }] }),
    ]);
  } catch (error) {
    const recorded = error instanceof BatchConflictError ? await knownTake(device.id, take.id) : null;
    if (!recorded) throw error;
    return recorded;
  }
  return outcome;
}

/**
 * The can is already out of the fridge: record it even if the books say the
 * stock is empty, so a count later shows the gap instead of hiding it.
 */
function consumptionWrites(
  db: BatchClient,
  device: AuthenticatedDevice,
  decision: Extract<Decision, { kind: "apply" }>,
  entryId: string,
) {
  const { officeId } = device;
  const { userId, itemId, date } = decision;
  const note = `Terminal ${device.name}`;
  return [
    db.consumptionEntry.createMany({
      data: [{ id: entryId, officeId, userId, itemId, date, qty: 1, source: "DEVICE", deviceId: device.id }],
    }),
    ...stockDeltaOps(db, { officeId, itemId, delta: -1, reason: "SERVED", note, userId }),
  ];
}

async function decideTake(device: AuthenticatedDevice, take: DeviceTake): Promise<Decision> {
  const reject = (reason: string): Decision => ({ kind: "reject", reason });
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

  if (!take.itemId) return reject("no_item");
  const item = await prisma.item.findFirst({ where: { id: take.itemId, officeId }, select: { id: true } });
  if (!item) return reject("unknown_item");

  const date = getDateInTimezone(new Date(take.at), device.office.timezone);
  return { kind: "apply", userId: badge.userId, itemId: item.id, date };
}

/** A known badge was tapped: its last pass moves forward, never back (takes can arrive late). */
async function markBadgeSeen(officeId: string, rawUid: string, at: Date) {
  const uid = normalizeBadgeUid(rawUid);
  if (!uid) return;
  await prisma.badge.updateMany({ where: { officeId, uid, lastSeenAt: { lt: at } }, data: { lastSeenAt: at } });
}

/** Remembers badges a terminal saw so an admin can give them to members. */
export async function recordBadges(officeId: string, uids: string[]) {
  const now = new Date();
  await inSequence(uids, async (uid) => {
    await prisma.badge.upsert({
      where: { officeId_uid: { officeId, uid } },
      create: { officeId, uid },
      update: { lastSeenAt: now },
    });
  });
}
