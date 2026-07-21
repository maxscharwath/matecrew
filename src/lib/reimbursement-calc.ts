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

export interface ItemPrice {
  itemId: string;
  itemName: string;
  /** Weighted-average purchase price for this item (purchases up to endDate). */
  unitPrice: number;
  /** Net qty of this item consumed in the period (cancel credits deducted). */
  qtyConsumed: number;
  /** qtyConsumed × unitPrice */
  cost: number;
}

export interface ReimbursementResult {
  shares: ConsumptionShare[];
  lines: PaymentLine[];
  totalConsumption: number;
  totalCost: number;
  /** Items consumed in the period, each billed at its own price. */
  itemPrices: ItemPrice[];
  /** totalCost / totalConsumption — for display only, never used in the math. */
  avgUnitPrice: number;
}

/**
 * Calculates reimbursements for a given period.
 *
 * Model:
 *   Purchases are bulk orders (e.g. 300 cans every few months) — NOT monthly.
 *   Each item is billed at its OWN weighted-average price:
 *
 *     unitPrice(item) = spend on item / qty of item purchased
 *
 *   counting only purchases made up to the period's endDate, so closed
 *   periods never shift when a later order is recorded.
 *
 *   A user's cost is the sum over items of (qty consumed × item price) — no
 *   cross-item subsidy between cheap and expensive products.
 *
 *   Payers are credited PER ITEM, proportionally to their spend on that item.
 *   Proof that no money is lost, per item i:
 *
 *     Let S_i = spend on i, Q_i = qty purchased, u_i = S_i/Q_i.
 *     Payer k spent spend_ki on i. In period j with C_ij units of i consumed:
 *       payer k credit = (spend_ki / S_i) × C_ij × u_i = spend_ki × C_ij / Q_i
 *     After ALL Q_i units are consumed: payer k total credit = spend_ki ✓
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
  // Purchases count up to the END of the endDate day (endDate is a date-only
  // value at UTC midnight; purchasedAt is a full timestamp).
  const purchaseCutoff = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);

  // 1. Active consumption in this period, grouped by user AND item.
  const consumptionByUserItem = await prisma.consumptionEntry.groupBy({
    by: ["userId", "itemId"],
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
    by: ["userId", "itemId"],
    where: {
      officeId,
      cancelledAt: { not: null, gte: startDate, lte: endDate },
      date: { not: { gte: startDate, lte: endDate } }, // original date outside this period
    },
    _sum: { qty: true },
  });

  // Net qty per user per item: consumption minus cancel credits.
  const qtyByUserItem = new Map<string, Map<string, number>>();
  const addQty = (userId: string, itemId: string, qty: number) => {
    let items = qtyByUserItem.get(userId);
    if (!items) {
      items = new Map();
      qtyByUserItem.set(userId, items);
    }
    items.set(itemId, (items.get(itemId) ?? 0) + qty);
  };
  for (const c of consumptionByUserItem) {
    addQty(c.userId, c.itemId, c._sum.qty ?? 0);
  }
  for (const c of cancelCredits) {
    addQty(c.userId, c.itemId, -(c._sum.qty ?? 0));
  }

  const allUserIds = [...qtyByUserItem.keys()];
  const users = await prisma.user.findMany({
    where: { id: { in: allUserIds } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  // 2. Purchase lines up to the period end. Each line carries its payer via
  //    the parent order.
  const purchaseLines = await prisma.purchaseLine.findMany({
    where: {
      batch: { officeId, purchasedAt: { lt: purchaseCutoff } },
    },
    select: {
      itemId: true,
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

  // 3. Per-item weighted-average unit price = item spend / item qty purchased,
  //    plus each payer's spend per item (for proportional credits).
  const itemSpend = new Map<string, number>();
  const itemQtyPurchased = new Map<string, number>();
  const spendByPayerItem = new Map<string, Map<string, number>>(); // itemId → payerId → spend
  for (const l of purchaseLines) {
    const spend = l.lineTotal.toNumber();
    itemSpend.set(l.itemId, (itemSpend.get(l.itemId) ?? 0) + spend);
    itemQtyPurchased.set(l.itemId, (itemQtyPurchased.get(l.itemId) ?? 0) + l.qty);

    let payers = spendByPayerItem.get(l.itemId);
    if (!payers) {
      payers = new Map();
      spendByPayerItem.set(l.itemId, payers);
    }
    payers.set(
      l.batch.paidByUserId,
      (payers.get(l.batch.paidByUserId) ?? 0) + spend,
    );
    if (!userMap.has(l.batch.paidByUserId)) {
      userMap.set(l.batch.paidByUserId, l.batch.paidBy.name);
    }
  }

  const unitPriceOf = (itemId: string): number => {
    const qty = itemQtyPurchased.get(itemId) ?? 0;
    if (qty <= 0) return 0; // consumed but never purchased — nothing to bill
    return Math.round(((itemSpend.get(itemId) ?? 0) / qty) * 100) / 100;
  };

  // 4. Net qty consumed per item in the period, then period cost per item.
  const itemQtyConsumed = new Map<string, number>();
  for (const items of qtyByUserItem.values()) {
    for (const [itemId, qty] of items) {
      itemQtyConsumed.set(itemId, (itemQtyConsumed.get(itemId) ?? 0) + qty);
    }
  }

  let totalConsumption = 0;
  let totalCost = 0;
  const itemCost = new Map<string, number>();
  for (const [itemId, qty] of itemQtyConsumed) {
    const cost = qty * unitPriceOf(itemId);
    itemCost.set(itemId, cost);
    totalConsumption += qty;
    totalCost += cost;
  }
  totalCost = Math.round(totalCost * 100) / 100;

  // 5. Credit each payer per item, proportionally to their spend on that item.
  const paidMap = new Map<string, number>();
  for (const [itemId, cost] of itemCost) {
    const spend = itemSpend.get(itemId) ?? 0;
    if (spend <= 0 || cost === 0) continue;
    for (const [payerId, payerSpend] of spendByPayerItem.get(itemId) ?? []) {
      const credit = (payerSpend / spend) * cost;
      paidMap.set(payerId, (paidMap.get(payerId) ?? 0) + credit);
    }
  }

  // 6. Build shares: each consumer's per-item cost vs their payer credit.
  const shares: ConsumptionShare[] = [];

  for (const [userId, items] of qtyByUserItem) {
    let qty = 0;
    let cost = 0;
    for (const [itemId, itemQty] of items) {
      qty += itemQty;
      cost += itemQty * unitPriceOf(itemId);
    }
    const costShare = Math.round(cost * 100) / 100;
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

  // 7. Per-item price list for display/export.
  const consumedItemIds = [...itemQtyConsumed.keys()];
  const items = consumedItemIds.length
    ? await prisma.item.findMany({
        where: { id: { in: consumedItemIds } },
        select: { id: true, name: true },
      })
    : [];
  const itemNameMap = new Map(items.map((i) => [i.id, i.name]));

  const itemPrices: ItemPrice[] = consumedItemIds
    .map((itemId) => ({
      itemId,
      itemName: itemNameMap.get(itemId) ?? "Unknown",
      unitPrice: unitPriceOf(itemId),
      qtyConsumed: itemQtyConsumed.get(itemId) ?? 0,
      cost: Math.round((itemCost.get(itemId) ?? 0) * 100) / 100,
    }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName));

  const avgUnitPrice =
    totalConsumption > 0
      ? Math.round((totalCost / totalConsumption) * 100) / 100
      : 0;

  return { shares, lines, totalConsumption, totalCost, itemPrices, avgUnitPrice };
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
