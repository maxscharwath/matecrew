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
}

export async function calculateReimbursements(
  officeId: string,
  startDate: Date,
  endDate: Date
): Promise<ReimbursementResult> {
  // Fetch consumption grouped by user
  const consumptionByUser = await prisma.consumptionEntry.groupBy({
    by: ["userId"],
    where: {
      officeId,
      date: { gte: startDate, lte: endDate },
    },
    _sum: { qty: true },
  });

  // Fetch user names for consumers
  const userIds = consumptionByUser.map((c) => c.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  // Fetch purchases in date range
  const purchases = await prisma.purchaseBatch.findMany({
    where: {
      officeId,
      purchasedAt: { gte: startDate, lte: endDate },
    },
    select: {
      paidByUserId: true,
      totalPrice: true,
      paidBy: { select: { id: true, name: true } },
    },
  });

  const totalConsumption = consumptionByUser.reduce(
    (sum, c) => sum + (c._sum.qty ?? 0),
    0
  );
  const totalCost = purchases.reduce(
    (sum, p) => sum + p.totalPrice.toNumber(),
    0
  );

  // Build payment map: how much each user paid
  const paidMap = new Map<string, number>();
  for (const p of purchases) {
    const current = paidMap.get(p.paidByUserId) ?? 0;
    paidMap.set(p.paidByUserId, current + p.totalPrice.toNumber());
    // Ensure payers are in userMap even if they didn't consume
    if (!userMap.has(p.paidByUserId)) {
      userMap.set(p.paidByUserId, p.paidBy.name);
    }
  }

  // Calculate shares
  const shares: ConsumptionShare[] = [];

  // Include all consumers
  for (const entry of consumptionByUser) {
    const qty = entry._sum.qty ?? 0;
    const costShare =
      totalConsumption > 0 ? (qty / totalConsumption) * totalCost : 0;
    const amountPaid = paidMap.get(entry.userId) ?? 0;

    shares.push({
      userId: entry.userId,
      userName: userMap.get(entry.userId) ?? "Unknown",
      qty,
      costShare: Math.round(costShare * 100) / 100,
      amountPaid: Math.round(amountPaid * 100) / 100,
      netOwed: Math.round((costShare - amountPaid) * 100) / 100,
    });
  }

  // Include payers who didn't consume (they are owed money)
  for (const [payerId, amount] of paidMap) {
    if (!shares.find((s) => s.userId === payerId)) {
      shares.push({
        userId: payerId,
        userName: userMap.get(payerId) ?? "Unknown",
        qty: 0,
        costShare: 0,
        amountPaid: Math.round(amount * 100) / 100,
        netOwed: Math.round(-amount * 100) / 100,
      });
    }
  }

  shares.sort((a, b) => a.userName.localeCompare(b.userName));

  // Generate payment lines (greedy settlement)
  const lines = generatePaymentLines(shares);

  return { shares, lines, totalConsumption, totalCost };
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
