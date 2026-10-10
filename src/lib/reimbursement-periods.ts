import { commitBatch, expectRows, guardedChunks, newId, prisma, retryOnConflict } from "@/lib/prisma";
import { buildCostingLedger } from "@/lib/costing";
import { fromCents, roundCents, toCents } from "@/lib/money";
import {
  calculateReimbursements,
  matchBalances,
  sliceLedger,
} from "@/lib/reimbursement-calc";
import { buildSettlementKey, buildUserSettlementKey } from "@/lib/storage";
import { platform } from "@/platform";

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
  const missing: { month: number; year: number }[] = [];
  const cursor = new Date(
    Date.UTC(earliest.getFullYear(), earliest.getMonth(), 1),
  );
  while (cursor <= lastMonth) {
    const month = cursor.getUTCMonth() + 1;
    const year = cursor.getUTCFullYear();
    if (!existingSet.has(`${year}-${month}`)) missing.push({ month, year });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  // Clicking "generate" on an office that is already up to date is the common
  // case, and it should not replay the whole history to create nothing.
  if (missing.length === 0) return { kind: "ok", created: 0 };

  // Replayed once for the whole backfill rather than once per month — the
  // months are slices of one causal history.
  const ledger = await buildCostingLedger(officeId);

  const periods = missing.flatMap(({ month, year }) => {
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    // Day 0 of the next month is the last day of this one.
    const endDate = new Date(Date.UTC(year, month, 0));

    const result = sliceLedger(ledger, startDate, endDate);
    if (result.totalConsumption === 0 && result.totalCost === 0) return [];
    return [{ row: { id: newId(), officeId, month, year, startDate, endDate }, lines: result.lines }];
  });
  if (periods.length === 0) return { kind: "ok", created: 0 };

  // Computed above, committed here in one atomic batch: every period with its
  // lines, or nothing. A concurrent backfill that created one of the months
  // first makes the batch fail on the (office, year, month) key.
  const lines = periods.flatMap((period) =>
    period.lines.map((l) => ({
      periodId: period.row.id,
      fromUserId: l.fromUserId,
      toUserId: l.toUserId,
      amountCents: toCents(l.amount),
      currency: "CHF",
    })),
  );
  await commitBatch((db) => [
    db.reimbursementPeriod.createMany({
      data: periods.map((period) => period.row),
    }),
    ...(lines.length > 0 ? [db.reimbursementLine.createMany({ data: lines })] : []),
  ]);

  return { kind: "ok", created: periods.length };
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
  const synced = await retryOnConflict(() => replacePendingLines(officeId, periodId));
  if (!synced) return { kind: "not_found" };
  const { result, paidLines, newLineCount } = synced;

  // Any cached settlement PDF now describes stale lines.
  const affectedUserIds = new Set([
    ...result.shares.map((s) => s.userId),
    ...paidLines.flatMap((l) => [l.fromUserId, l.toUserId]),
  ]);
  await Promise.allSettled([
    platform.storage.delete(buildSettlementKey(periodId)),
    ...[...affectedUserIds].map((uid) =>
      platform.storage.delete(buildUserSettlementKey(periodId, uid)),
    ),
  ]);

  return { kind: "ok", lines: newLineCount + paidLines.length };
}

/**
 * Reads the period, recomputes its PENDING lines and swaps them in one atomic
 * batch. Guards: the PENDING lines deleted must be exactly the ones read (none
 * paid meanwhile), and no other PENDING line may exist (no concurrent sync
 * added its own); otherwise the batch rolls back and the caller retries.
 */
async function replacePendingLines(officeId: string, periodId: string) {
  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
    include: { lines: true },
  });

  if (!period || period.officeId !== officeId) return null;

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
    const amount = fromCents(paid.amountCents);
    balanceMap.set(
      paid.fromUserId,
      (balanceMap.get(paid.fromUserId) ?? 0) - amount,
    );
    balanceMap.set(paid.toUserId, (balanceMap.get(paid.toUserId) ?? 0) + amount);
  }

  const newLines = matchBalances(
    [...balanceMap].map(([userId, balance]) => ({
      userId,
      netOwed: roundCents(balance),
    })),
  );

  await commitBatch((db) => [
    ...guardedChunks(pendingLineIds).map((ids) =>
      expectRows(db.reimbursementLine.deleteMany({ where: { periodId, status: "PENDING", id: { in: ids } } }), ids.length),
    ),
    expectRows(db.reimbursementLine.deleteMany({ where: { periodId, status: "PENDING" } }), 0),
    ...(newLines.length > 0
      ? [
          db.reimbursementLine.createMany({
            data: newLines.map((l) => ({
              periodId,
              fromUserId: l.fromUserId,
              toUserId: l.toUserId,
              amountCents: toCents(l.amount),
              currency: "CHF",
            })),
          }),
        ]
      : []),
  ]);

  return { result, paidLines, newLineCount: newLines.length };
}
