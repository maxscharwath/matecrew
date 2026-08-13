import { buildCostingLedger, type CostingLedger } from "@/lib/costing";
import { roundCents } from "@/lib/money";

export interface ConsumptionShare {
  userId: string;
  userName: string;
  qty: number;
  costShare: number;
  /** Part of `costShare` that is this person's share of the missing cans. */
  lossShare: number;
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
  /** Average price actually charged for this item over the period. */
  unitPrice: number;
  /** Net qty of this item drunk in the period (cancel credits deducted). */
  qtyConsumed: number;
  /** qtyConsumed × unitPrice */
  cost: number;
  /** Cans of this item missing at inventory (negative = surplus found). */
  lossQty: number;
  /** What those missing cans were worth. */
  lossCost: number;
}

export interface ReimbursementResult {
  shares: ConsumptionShare[];
  lines: PaymentLine[];
  totalConsumption: number;
  /** Everything billed this period: what was drunk plus the shrinkage. */
  totalCost: number;
  /** Cost of what was actually drunk. */
  drinkCost: number;
  /** Cans missing at inventory over the period. */
  lossQty: number;
  /** Value of the missing cans, spread over the period's drinkers. */
  lossCost: number;
  /**
   * Shrinkage nobody could be billed for — a count came up short in a period
   * where nothing was drunk. It stays on the buyer, and the UI says so.
   */
  unallocatedLossCost: number;
  /** Items consumed in the period, each billed at its own price. */
  itemPrices: ItemPrice[];
  /** drinkCost / totalConsumption — for display only, never used in the math. */
  avgUnitPrice: number;
}

/**
 * Calculates reimbursements for a given period.
 *
 * The arithmetic lives in `@/lib/costing`: every can is drawn from its item's
 * value pool at the moving-average price of the stock it came from, and the
 * payers whose money is in that pool are credited the same amount. This file
 * only slices those draws by period and decides who carries the shrinkage.
 *
 * Missing cans are charged to the people who drank during the period, in
 * proportion to how much they drank. Without that, an inventory gap is silently
 * paid by whoever bought the last order: they hold the receipt for cans that
 * are never billed to anyone.
 *
 * Purchases and losses count up to the end of `endDate` and nothing after, so a
 * closed month never reshuffles when the next bulk order is recorded. Payment
 * lines are frozen in the DB at generation time; this calculation drives
 * previews and new periods.
 */
export async function calculateReimbursements(
  officeId: string,
  startDate: Date,
  endDate: Date,
): Promise<ReimbursementResult> {
  return sliceLedger(await buildCostingLedger(officeId), startDate, endDate);
}

interface UserTotals {
  qty: number;
  drinkCost: number;
  credit: number;
  /** Credit for shrinkage, held apart until we know somebody can be billed. */
  lossCredit: number;
}

interface ItemTotals {
  qty: number;
  cost: number;
  lossQty: number;
  lossCost: number;
}

/**
 * The period arithmetic, over an already-built ledger.
 *
 * Split out from `calculateReimbursements` so a screen showing a dozen periods
 * replays the office's history once rather than once per period. The replay is
 * causal, so slicing a full ledger gives the same numbers a truncated one would.
 */
export function sliceLedger(
  ledger: CostingLedger,
  startDate: Date,
  endDate: Date,
): ReimbursementResult {
  // endDate is a date-only value at UTC midnight; events carry a full
  // timestamp, so the period runs up to the start of the following day.
  const cutoff = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);

  const byUser = new Map<string, UserTotals>();
  const userTotals = (userId: string) =>
    getOrCreate(byUser, userId, () => ({
      qty: 0,
      drinkCost: 0,
      credit: 0,
      lossCredit: 0,
    }));

  const byItem = new Map<string, ItemTotals>();
  const itemTotals = (itemId: string) =>
    getOrCreate(byItem, itemId, () => ({
      qty: 0,
      cost: 0,
      lossQty: 0,
      lossCost: 0,
    }));

  let lossQty = 0;
  let lossCost = 0;
  let totalConsumption = 0;
  let drinkCostRaw = 0;

  for (const draw of ledger.draws) {
    if (draw.at < startDate || draw.at >= cutoff) continue;
    const item = itemTotals(draw.itemId);

    if (draw.kind === "SHRINKAGE") {
      lossQty += draw.qty;
      lossCost += draw.cost;
      item.lossQty += draw.qty;
      item.lossCost += draw.cost;
      // Held apart: these credits only stand if somebody can be billed for the
      // loss, otherwise the period would credit payers out of thin air.
      for (const [payerId, credit] of draw.credits) {
        userTotals(payerId).lossCredit += credit;
      }
      continue;
    }

    // CONSUMPTION, or RETURN which carries negative qty and cost.
    const drinker = userTotals(draw.userId!);
    drinker.qty += draw.qty;
    drinker.drinkCost += draw.cost;
    item.qty += draw.qty;
    item.cost += draw.cost;
    totalConsumption += draw.qty;
    drinkCostRaw += draw.cost;
    for (const [payerId, credit] of draw.credits) {
      userTotals(payerId).credit += credit;
    }
  }

  // Shrinkage is shared out by how much each person drank. Someone whose net
  // consumption is zero or negative (more cancellations than cans) carries none
  // of it rather than being credited for the loss.
  let totalWeight = 0;
  for (const totals of byUser.values()) {
    if (totals.qty > 0) totalWeight += totals.qty;
  }
  const billable = totalWeight > 0;
  const unallocatedLossCost = billable ? 0 : lossCost;

  const shares: ConsumptionShare[] = [...byUser]
    .map(([userId, totals]) => {
      const lossShare = roundCents(
        billable && totals.qty > 0 ? (totals.qty / totalWeight) * lossCost : 0,
      );
      const costShare = roundCents(totals.drinkCost + lossShare);
      const amountPaid = roundCents(
        totals.credit + (billable ? totals.lossCredit : 0),
      );
      return {
        userId,
        userName: ledger.userNames.get(userId) ?? "Unknown",
        qty: totals.qty,
        costShare,
        lossShare,
        amountPaid,
        netOwed: roundCents(costShare - amountPaid),
      };
    })
    .sort((a, b) => a.userName.localeCompare(b.userName));

  const itemPrices: ItemPrice[] = [...byItem]
    .map(([itemId, totals]) => ({
      itemId,
      itemName: ledger.itemNames.get(itemId) ?? "Unknown",
      unitPrice:
        totals.qty > 0
          ? roundCents(totals.cost / totals.qty)
          : roundCents(ledger.priceAt(itemId, endDate).unitCost),
      qtyConsumed: totals.qty,
      cost: roundCents(totals.cost),
      lossQty: totals.lossQty,
      lossCost: roundCents(totals.lossCost),
    }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName));

  const drinkCost = roundCents(drinkCostRaw);

  return {
    shares,
    lines: generatePaymentLines(shares),
    totalConsumption,
    totalCost: roundCents(drinkCost + (billable ? lossCost : 0)),
    drinkCost,
    lossQty,
    lossCost: roundCents(lossCost),
    unallocatedLossCost: roundCents(unallocatedLossCost),
    itemPrices,
    avgUnitPrice: totalConsumption > 0 ? roundCents(drinkCost / totalConsumption) : 0,
  };
}

/** Balances below this are settled — a centime nobody is going to transfer. */
const SETTLED = 0.01;

/**
 * Turns net balances into the fewest transfers that clear them: biggest debtor
 * pays biggest creditor until one of them is square, repeat.
 *
 * Shared with `syncReimbursementPeriod`, which re-matches a period's unpaid
 * lines. A preview and the lines eventually written to the DB have to agree to
 * the centime, and two copies of a greedy matcher eventually would not.
 */
export function matchBalances(
  balances: { userId: string; netOwed: number }[],
): { fromUserId: string; toUserId: string; amount: number }[] {
  const debtors = balances
    .filter((b) => b.netOwed > SETTLED)
    .map((b) => ({ userId: b.userId, remaining: b.netOwed }))
    .sort((a, b) => b.remaining - a.remaining);

  const creditors = balances
    .filter((b) => b.netOwed < -SETTLED)
    .map((b) => ({ userId: b.userId, remaining: -b.netOwed }))
    .sort((a, b) => b.remaining - a.remaining);

  const lines: { fromUserId: string; toUserId: string; amount: number }[] = [];
  let di = 0;
  let ci = 0;

  while (di < debtors.length && ci < creditors.length) {
    const amount = Math.min(debtors[di].remaining, creditors[ci].remaining);
    if (amount > SETTLED) {
      lines.push({
        fromUserId: debtors[di].userId,
        toUserId: creditors[ci].userId,
        amount: roundCents(amount),
      });
    }
    debtors[di].remaining -= amount;
    creditors[ci].remaining -= amount;
    if (debtors[di].remaining < SETTLED) di++;
    if (creditors[ci].remaining < SETTLED) ci++;
  }

  return lines;
}

function generatePaymentLines(shares: ConsumptionShare[]): PaymentLine[] {
  const nameOf = new Map(shares.map((s) => [s.userId, s.userName]));
  return matchBalances(shares).map((l) => ({
    ...l,
    fromUserName: nameOf.get(l.fromUserId) ?? "Unknown",
    toUserName: nameOf.get(l.toUserId) ?? "Unknown",
  }));
}

/** Reads a map entry, inserting a fresh one the first time a key is seen. */
function getOrCreate<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
}
