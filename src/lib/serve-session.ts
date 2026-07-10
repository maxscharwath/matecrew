import { prisma } from "@/lib/prisma";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { stockDeltaOps } from "@/lib/stock";

export type ServeSessionResult =
  | { kind: "ok"; servedCount: number }
  | { kind: "empty" };

/**
 * Marks every REQUESTED order of (officeId, mateSessionId, date) as SERVED,
 * creates the matching consumption entries and the bulk stock movement.
 *
 * Shared between the runner UI server action and the Slack "mark all served"
 * button — the latter has no authenticated office membership, so the caller
 * supplies the user that should be attributed for the stock movement (null
 * when the Slack clicker can't be linked to a MateCrew user).
 */
export async function serveSession(opts: {
  officeId: string;
  mateSessionId: string | null;
  date: Date;
  actingUserId: string | null;
  movementNote?: string;
}): Promise<ServeSessionResult> {
  const pending = await prisma.dailyRequest.findMany({
    where: {
      officeId: opts.officeId,
      date: opts.date,
      status: "REQUESTED",
      mateSessionId: opts.mateSessionId,
    },
  });

  if (pending.length === 0) return { kind: "empty" };

  // Group the pending requests by item so each item's stock pool is
  // decremented independently.
  const byItem = new Map<string, typeof pending>();
  for (const r of pending) {
    const list = byItem.get(r.itemId);
    if (list) list.push(r);
    else byItem.set(r.itemId, [r]);
  }

  const ops = [
    prisma.dailyRequest.updateMany({
      where: { id: { in: pending.map((r) => r.id) } },
      data: { status: "SERVED" },
    }),
    ...pending.map((r) =>
      prisma.consumptionEntry.create({
        data: {
          officeId: opts.officeId,
          userId: r.userId,
          itemId: r.itemId,
          date: r.date,
          qty: 1,
          source: "DAILY_REQUEST",
        },
      }),
    ),
    ...[...byItem.entries()].flatMap(([itemId, reqs]) =>
      stockDeltaOps({
        officeId: opts.officeId,
        itemId,
        delta: -reqs.length,
        reason: "SERVED",
        note: opts.movementNote ?? `Batch serve (${reqs.length})`,
        userId: opts.actingUserId,
      }),
    ),
  ];

  await prisma.$transaction(ops);

  for (const itemId of byItem.keys()) {
    checkAndAlertLowStock(opts.officeId, itemId).catch(() => {});
  }

  return { kind: "ok", servedCount: pending.length };
}
