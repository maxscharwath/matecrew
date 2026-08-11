import { prisma } from "@/lib/prisma";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import {
  buildSettlementKey,
  buildUserSettlementKey,
  deleteFile,
} from "@/lib/storage";

/**
 * Reimbursement period lifecycle, shared by the admin screen's server actions
 * and the MCP admin tools. Both entry points must produce identical money, so
 * the arithmetic lives here rather than being written twice.
 *
 * A period freezes its payment lines at generation time so a later bulk order
 * never reshuffles a month someone has already settled.
 */

export type BackfillResult =
  | { kind: "ok"; created: number }
  | { kind: "no_activity" };

/**
 * Creates a period for every month from the office's first activity up to last
 * month that doesn't have one yet. Months with no consumption and no spend are
 * skipped, and the current month is left alone because it isn't over.
 */
export async function backfillReimbursementPeriods(
  officeId: string,
): Promise<BackfillResult> {
  const [earliestConsumption, earliestPurchase] = await Promise.all([
    prisma.consumptionEntry.findFirst({
      where: { officeId },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
    prisma.purchaseBatch.findFirst({
      where: { officeId },
      orderBy: { purchasedAt: "asc" },
      select: { purchasedAt: true },
    }),
  ]);

  const dates = [
    earliestConsumption?.date,
    earliestPurchase?.purchasedAt,
  ].filter((d): d is Date => d != null);

  if (dates.length === 0) return { kind: "no_activity" };

  const earliest = dates.sort((a, b) => a.getTime() - b.getTime())[0];

  const existingPeriods = await prisma.reimbursementPeriod.findMany({
    where: { officeId },
    select: { month: true, year: true },
  });
  const existingSet = new Set(
    existingPeriods.map((p) => `${p.year}-${p.month}`),
  );

  const now = new Date();
  const lastMonth = new Date(
    Date.UTC(now.getFullYear(), now.getMonth() - 1, 1),
  );
  let created = 0;

  const cursor = new Date(
    Date.UTC(earliest.getFullYear(), earliest.getMonth(), 1),
  );
  while (cursor <= lastMonth) {
    const month = cursor.getUTCMonth() + 1;
    const year = cursor.getUTCFullYear();

    if (!existingSet.has(`${year}-${month}`)) {
      const startDate = new Date(Date.UTC(year, month - 1, 1));
      // Day 0 of the next month is the last day of this one.
      const endDate = new Date(Date.UTC(year, month, 0));

      const result = await calculateReimbursements(
        officeId,
        startDate,
        endDate,
      );

      if (result.totalConsumption > 0 || result.totalCost > 0) {
        await prisma.reimbursementPeriod.create({
          data: {
            officeId,
            month,
            year,
            startDate,
            endDate,
            lines: {
              create: result.lines.map((l) => ({
                fromUserId: l.fromUserId,
                toUserId: l.toUserId,
                amount: l.amount,
                currency: "CHF",
              })),
            },
          },
        });
        created++;
      }
    }

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return { kind: "ok", created };
}

export type SyncPeriodResult =
  | { kind: "ok"; lines: number }
  | { kind: "not_found" };

/**
 * Recomputes a period's PENDING payment lines from current data, leaving PAID
 * lines untouched.
 *
 * Money already handed over is a fact, so the residual balance is the fresh
 * calculation minus what the PAID lines already cover. Debtors and creditors
 * are then re-matched largest-first, which keeps the number of transfers low.
 */
export async function syncReimbursementPeriod(
  officeId: string,
  periodId: string,
): Promise<SyncPeriodResult> {
  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
    include: { lines: true },
  });

  if (!period || period.officeId !== officeId) return { kind: "not_found" };

  const result = await calculateReimbursements(
    officeId,
    period.startDate,
    period.endDate,
  );

  const paidLines = period.lines.filter((l) => l.status === "PAID");
  const pendingLineIds = period.lines
    .filter((l) => l.status === "PENDING")
    .map((l) => l.id);

  // netOwed > 0 means the user owes money; < 0 means they are owed.
  const balanceMap = new Map<string, number>();
  for (const share of result.shares) {
    balanceMap.set(share.userId, share.netOwed);
  }

  for (const paid of paidLines) {
    const amount = paid.amount.toNumber();
    balanceMap.set(
      paid.fromUserId,
      (balanceMap.get(paid.fromUserId) ?? 0) - amount,
    );
    balanceMap.set(paid.toUserId, (balanceMap.get(paid.toUserId) ?? 0) + amount);
  }

  const debtors: { userId: string; remaining: number }[] = [];
  const creditors: { userId: string; remaining: number }[] = [];

  for (const [userId, balance] of balanceMap) {
    const rounded = Math.round(balance * 100) / 100;
    if (rounded > 0.01) debtors.push({ userId, remaining: rounded });
    else if (rounded < -0.01) creditors.push({ userId, remaining: -rounded });
  }

  debtors.sort((a, b) => b.remaining - a.remaining);
  creditors.sort((a, b) => b.remaining - a.remaining);

  const newLines: { fromUserId: string; toUserId: string; amount: number }[] =
    [];
  let di = 0;
  let ci = 0;

  while (di < debtors.length && ci < creditors.length) {
    const amount = Math.min(debtors[di].remaining, creditors[ci].remaining);
    if (amount > 0.01) {
      newLines.push({
        fromUserId: debtors[di].userId,
        toUserId: creditors[ci].userId,
        amount: Math.round(amount * 100) / 100,
      });
    }
    debtors[di].remaining -= amount;
    creditors[ci].remaining -= amount;
    if (debtors[di].remaining < 0.01) di++;
    if (creditors[ci].remaining < 0.01) ci++;
  }

  await prisma.$transaction([
    prisma.reimbursementLine.deleteMany({
      where: { id: { in: pendingLineIds } },
    }),
    ...newLines.map((l) =>
      prisma.reimbursementLine.create({
        data: {
          periodId,
          fromUserId: l.fromUserId,
          toUserId: l.toUserId,
          amount: l.amount,
          currency: "CHF",
        },
      }),
    ),
  ]);

  // Any cached settlement PDF now describes stale lines.
  const affectedUserIds = new Set([
    ...result.shares.map((s) => s.userId),
    ...paidLines.flatMap((l) => [l.fromUserId, l.toUserId]),
  ]);
  await Promise.allSettled([
    deleteFile(buildSettlementKey(periodId)),
    ...[...affectedUserIds].map((uid) =>
      deleteFile(buildUserSettlementKey(periodId, uid)),
    ),
  ]);

  return { kind: "ok", lines: newLines.length + paidLines.length };
}
