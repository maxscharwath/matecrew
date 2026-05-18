import { prisma } from "@/lib/prisma";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";

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

  const stock = await prisma.stock.findUnique({
    where: { officeId: opts.officeId },
  });
  const newQty = (stock?.currentQty ?? 0) - pending.length;

  await prisma.$transaction([
    prisma.dailyRequest.updateMany({
      where: { id: { in: pending.map((r) => r.id) } },
      data: { status: "SERVED" },
    }),
    ...pending.map((r) =>
      prisma.consumptionEntry.create({
        data: {
          officeId: opts.officeId,
          userId: r.userId,
          date: r.date,
          qty: 1,
          source: "DAILY_REQUEST",
        },
      }),
    ),
    prisma.stockMovement.create({
      data: {
        officeId: opts.officeId,
        delta: -pending.length,
        reason: "SERVED",
        note: opts.movementNote ?? `Batch serve (${pending.length})`,
        userId: opts.actingUserId,
      },
    }),
    prisma.stock.update({
      where: { officeId: opts.officeId },
      data: { currentQty: newQty },
    }),
  ]);

  checkAndAlertLowStock(opts.officeId).catch(() => {});

  return { kind: "ok", servedCount: pending.length };
}
