import { commitBatch, expectRows, guardedChunks, prisma, retryOnConflict } from "@/lib/prisma";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { platform } from "@/platform";
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
 *
 * Reads the pending requests, then commits everything in one atomic batch.
 * The guard requires every one of them to still be REQUESTED; if a runner or
 * the Slack button served or cancelled one in between, nothing is written and
 * the whole thing runs again on fresh data.
 */
export function serveSession(opts: ServeSessionOptions): Promise<ServeSessionResult> {
  return retryOnConflict(() => serveOnce(opts));
}

interface ServeSessionOptions {
  readonly officeId: string;
  readonly mateSessionId: string | null;
  readonly date: Date;
  readonly actingUserId: string | null;
  readonly movementNote?: string;
}

async function serveOnce(opts: ServeSessionOptions): Promise<ServeSessionResult> {
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

  await commitBatch((db) => [
    ...guardedChunks(pending.map((r) => r.id)).map((ids) =>
      expectRows(
        db.dailyRequest.updateMany({
          where: { id: { in: ids }, status: "REQUESTED" },
          data: { status: "SERVED" },
        }),
        ids.length,
      ),
    ),
    db.consumptionEntry.createMany({
      data: pending.map((r) => ({
        officeId: opts.officeId,
        userId: r.userId,
        itemId: r.itemId,
        date: r.date,
        qty: 1,
        source: "DAILY_REQUEST" as const,
      })),
    }),
    ...[...byItem.entries()].flatMap(([itemId, reqs]) =>
      stockDeltaOps(db, {
        officeId: opts.officeId,
        itemId,
        delta: -reqs.length,
        reason: "SERVED",
        note: opts.movementNote ?? `Batch serve (${reqs.length})`,
        userId: opts.actingUserId,
      }),
    ),
  ]);

  for (const itemId of byItem.keys()) {
    platform.runInBackground(checkAndAlertLowStock(opts.officeId, itemId), "low-stock alert");
  }

  return { kind: "ok", servedCount: pending.length };
}
