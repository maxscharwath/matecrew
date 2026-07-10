import { prisma } from "@/lib/prisma";

export interface ConsumptionShare {
  userId: string;
  userName: string;
  qty: number;
  costShare: number;
  amountPaid: number;
  netOwed: number; // positive = owes money, negative = is owed money
}

export interface PaymentLine {
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  amount: number;
}

export interface ReimbursementResult {
  shares: ConsumptionShare[];
  lines: PaymentLine[];
  totalConsumption: number;
  totalCost: number;
  unitPrice: number;
}

/**
 * Calculates reimbursements for a given period.
 *
 * Model:
 *   Purchases are bulk orders (e.g. 300 cans every few months) — NOT monthly.
 *   Items are just labels for what's in stock; every consumption is billed at a
 *   single blended price, so all products cost the same per unit.
 *
 *   Unit price = weighted average across ALL purchase lines for the office
 *   (total spend / total qty purchased), global (not capped at endDate) — proof
 *   that this guarantees no money is lost:
 *
 *     Let S = total spend, Q = total purchased qty, u = S/Q.
 *     Payer k spent spend_k. Their credit % = spend_k / S.
 *     In period j with C_j units consumed:
 *       payer k credit = (spend_k / S) × C_j × u = spend_k × C_j / Q
 *     After ALL Q units consumed (C = Q): payer k total credit = spend_k ✓
 *
 *   Every payer gets back exactly what they spent. Zero money lost.
 *
 *   Note: payment line amounts are frozen in the DB when a period is
 *   generated. The live calculation here is used for display and for
 *   generating new periods.
 */
export async function calculateReimbursements(
  officeId: string,
  startDate: Date,
  endDate: Date,
): Promise<ReimbursementResult> {
  // 1. Active consumption in this period, grouped by user (item-agnostic).
  const consumptionByUser = await prisma.consumptionEntry.groupBy({
    by: ["userId"],
    where: {
      officeId,
      date: { gte: startDate, lte: endDate },
      cancelledAt: null,
    },
    _sum: { qty: true },
  });

  // 1b. Credits: entries from OTHER periods that were cancelled DURING this
  //     period. These act as negative consumption (credit notes).
  //     An entry cancelled in its own period is already excluded by (1).
  const cancelCredits = await prisma.consumptionEntry.groupBy({
    by: ["userId"],
    where: {
      officeId,
      cancelledAt: { not: null, gte: startDate, lte: endDate },
      date: { not: { gte: startDate, lte: endDate } }, // original date outside this period
    },
    _sum: { qty: true },
  });

  // Net qty per user: consumption minus cancel credits.
  const qtyMap = new Map<string, number>();
  for (const c of consumptionByUser) {
    qtyMap.set(c.userId, (qtyMap.get(c.userId) ?? 0) + (c._sum.qty ?? 0));
  }
  for (const c of cancelCredits) {
    qtyMap.set(c.userId, (qtyMap.get(c.userId) ?? 0) - (c._sum.qty ?? 0));
  }

  const allUserIds = [...new Set([
    ...consumptionByUser.map((c) => c.userId),
    ...cancelCredits.map((c) => c.userId),
  ])];
  const users = await prisma.user.findMany({
    where: { id: { in: allUserIds } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  const totalConsumption = [...qtyMap.values()].reduce(
    (sum, qty) => sum + qty,
    0,
  );

  // 2. ALL purchase lines for this office (global, not date-scoped). Each line
  //    carries its payer via the parent order.
  const purchaseLines = await prisma.purchaseLine.findMany({
    where: { batch: { officeId } },
    select: {
      qty: true,
      lineTotal: true,
      batch: {
        select: {
          paidByUserId: true,
          paidBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  // 3. Single weighted-average unit price = total spend / total qty purchased.
  const totalPurchasedQty = purchaseLines.reduce((sum, l) => sum + l.qty, 0);
  const totalPurchaseSpend = purchaseLines.reduce(
    (sum, l) => sum + l.lineTotal.toNumber(),
    0,
  );
  const unitPrice =
    totalPurchasedQty > 0
      ? Math.round((totalPurchaseSpend / totalPurchasedQty) * 100) / 100
      : 0;

  // 4. Period cost = units consumed × unit price
  const totalCost = Math.round(totalConsumption * unitPrice * 100) / 100;

  // 5. Credit each payer proportionally to their total spend.
  const paidMap = new Map<string, number>();
  if (totalPurchaseSpend > 0) {
    const spendByPayer = new Map<string, number>();
    for (const l of purchaseLines) {
      spendByPayer.set(
        l.batch.paidByUserId,
        (spendByPayer.get(l.batch.paidByUserId) ?? 0) + l.lineTotal.toNumber(),
      );
      if (!userMap.has(l.batch.paidByUserId)) {
        userMap.set(l.batch.paidByUserId, l.batch.paidBy.name);
      }
    }

    for (const [payerId, payerSpend] of spendByPayer) {
      const credit = (payerSpend / totalPurchaseSpend) * totalCost;
      paidMap.set(payerId, credit);
    }
  }

  // 6. Build shares: each consumer's cost vs their payer credit
  const shares: ConsumptionShare[] = [];

  for (const [userId, qty] of qtyMap) {
    const costShare = Math.round(qty * unitPrice * 100) / 100;
    const amountPaid = Math.round((paidMap.get(userId) ?? 0) * 100) / 100;

    shares.push({
      userId,
      userName: userMap.get(userId) ?? "Unknown",
      qty,
      costShare,
      amountPaid,
      netOwed: Math.round((costShare - amountPaid) * 100) / 100,
    });
  }

  // Include payers who didn't consume in this period (they are owed money)
  for (const [payerId, credit] of paidMap) {
    if (!shares.some((s) => s.userId === payerId)) {
      const amountPaid = Math.round(credit * 100) / 100;
      shares.push({
        userId: payerId,
        userName: userMap.get(payerId) ?? "Unknown",
        qty: 0,
        costShare: 0,
        amountPaid,
        netOwed: -amountPaid,
      });
    }
  }

  shares.sort((a, b) => a.userName.localeCompare(b.userName));

  const lines = generatePaymentLines(shares);

  return { shares, lines, totalConsumption, totalCost, unitPrice };
}

function generatePaymentLines(shares: ConsumptionShare[]): PaymentLine[] {
  const debtors = shares
    .filter((s) => s.netOwed > 0.01)
    .map((s) => ({ ...s, remaining: s.netOwed }))
    .sort((a, b) => b.remaining - a.remaining);

  const creditors = shares
    .filter((s) => s.netOwed < -0.01)
    .map((s) => ({ ...s, remaining: -s.netOwed }))
    .sort((a, b) => b.remaining - a.remaining);

  const lines: PaymentLine[] = [];
  let di = 0;
  let ci = 0;

  while (di < debtors.length && ci < creditors.length) {
    const amount = Math.min(debtors[di].remaining, creditors[ci].remaining);
    if (amount > 0.01) {
      lines.push({
        fromUserId: debtors[di].userId,
        fromUserName: debtors[di].userName,
        toUserId: creditors[ci].userId,
        toUserName: creditors[ci].userName,
        amount: Math.round(amount * 100) / 100,
      });
    }
    debtors[di].remaining -= amount;
    creditors[ci].remaining -= amount;
    if (debtors[di].remaining < 0.01) di++;
    if (creditors[ci].remaining < 0.01) ci++;
  }

  return lines;
}
