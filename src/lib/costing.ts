import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { utcDate } from "@/lib/date";

/**
 * Inventory costing for the fridge — the single source of truth for "what did
 * this can cost?".
 *
 * ## The model: moving average over the stock that is still there
 *
 * Each item owns a value pool: `qty` cans worth `value` francs. A delivery adds
 * both; drinking a can removes one unit of qty and one unit-cost of value. The
 * unit cost is always `value / qty`, so it is re-averaged at every delivery and
 * — this is the point — *forgets a purchase once its cans have been drunk*.
 *
 * The previous model averaged every purchase ever made, which meant a bulk
 * order from February still dragged the price up months after its last can was
 * gone (CHF 1.52 billed for cans that cost 1.42). A moving average converges on
 * the real price within one or two orders and leaves the unconsumed stock
 * carrying its own value into the next period, where it belongs.
 *
 * Drinking does not change the unit cost — removing `n × value/qty` from a pool
 * leaves `value/qty` untouched. So an item's price is a step function that only
 * moves on deliveries, returns and inventory surpluses.
 *
 * ## Every draw balances
 *
 * A draw charges somebody and credits the payers whose francs are sitting in
 * the pool, always for the same amount. Debits equal credits by construction,
 * so a settlement can never invent or lose money. As the last can of a delivery
 * is drawn, its payer has been credited exactly what they spent.
 *
 * ## Items with no history of their own
 *
 * A can drawn from an empty pool (item never bought, or drunk before its first
 * delivery) is taken from the shelf as a whole: every pool gives up quantity
 * and value in proportion to what it holds, which prices the can at the blended
 * office rate without moving any pool's own unit cost. Billing it at zero, as
 * before, quietly handed the buyer the bill; crediting the payers without
 * emptying their pools would have paid them the same francs twice.
 *
 * ## Shrinkage
 *
 * A negative inventory delta draws from the pool like a consumption: the payers
 * get their money back. Who gets charged is decided one level up, in
 * `calculateReimbursements`, which spreads it over the period's drinkers.
 */

/** Value pool for one item: `qty` cans holding `value` francs. */
interface Pool {
  qty: number;
  value: number;
  /** Whose francs are still in this pool. Sums to `value`. */
  payers: Map<string, number>;
}

/** One movement of value out of (or, when negative, back into) a pool. */
export interface CostDraw {
  kind:
    /** A can was drunk. */
    | "CONSUMPTION"
    /** A consumption was cancelled: the can went back on the shelf. */
    | "RETURN"
    /** A count came up short — or long, in which case `qty` is negative. */
    | "SHRINKAGE";
  at: Date;
  itemId: string;
  /** Cans drawn. Negative for returns and inventory surpluses. */
  qty: number;
  /** Francs drawn. Negative for returns and inventory surpluses. */
  cost: number;
  /** Credit owed to each payer for this draw, summing to `cost`. */
  credits: Map<string, number>;
  /** The drinker, for CONSUMPTION and RETURN. */
  userId?: string;
  /**
   * The row this draw came from — a consumption entry, or the stock-count line
   * for SHRINKAGE. Lets a screen attribute exact francs back to the record that
   * caused them instead of re-deriving a price.
   */
  sourceId: string;
}

/** The unit cost of one item right after a delivery. */
export interface PricePoint {
  at: Date;
  itemId: string;
  /** Moving-average unit cost of the pool after this delivery. */
  unitCost: number;
  /** Cans and francs on this line, so several lines of one item can be blended. */
  qty: number;
  spend: number;
  batchId: string;
}

/** What one can of an item was worth at a point in time. */
export interface ItemPriceAt {
  unitCost: number;
  /**
   * True when the number comes from the office-wide blend because the item had
   * no delivery of its own yet. The single answer to "is this a fallback
   * price?" — charts and settlements must not each decide it for themselves.
   */
  estimated: boolean;
}

export interface CostingLedger {
  draws: CostDraw[];
  /** Unit cost after each delivery, chronological — the price-history chart. */
  priceHistory: PricePoint[];
  /** Price of one can of `itemId` on the day of `at`. */
  priceAt: (itemId: string, at: Date) => ItemPriceAt;
  /** Everyone who appears as a payer or a drinker. */
  userNames: Map<string, string>;
  /**
   * Every item ever bought or drunk, in the office's display order — Map
   * iteration follows insertion, so this doubles as the ordered item list.
   */
  itemNames: Map<string, string>;
}

/** Start of the UTC day, so same-day events sort deterministically. */
function dayStart(d: Date): Date {
  return utcDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

type EventKind = "PURCHASE" | "RETURN" | "CONSUMPTION" | "INVENTORY";

/**
 * Within a day: deliveries land first (cans arrive in the morning), returns go
 * back on the shelf next, then the day is drunk, and the count that closes the
 * day sees what is left.
 */
const EVENT_ORDER: Record<EventKind, number> = {
  PURCHASE: 0,
  RETURN: 1,
  CONSUMPTION: 2,
  INVENTORY: 3,
};

/**
 * Discriminated so the replay cannot read a field the event does not carry —
 * a wrong-branch read here would quietly put NaN in a settlement.
 */
type LedgerEvent = { at: Date; itemId: string; qty: number } & (
  | { kind: "PURCHASE"; spend: number; payerId: string; batchId: string }
  | { kind: "CONSUMPTION" | "RETURN"; userId: string; entryId: string }
  | { kind: "INVENTORY"; sourceId: string }
);

/**
 * Replays the office's whole history and returns every draw of value it
 * produced.
 *
 * The replay is total rather than incremental because the price of a can
 * depends on everything that came before it; there is no shortcut that keeps
 * closed periods stable. Offices are small (a few thousand entries a year), so
 * this is three queries and a linear pass.
 *
 * There is no cutoff parameter: the replay is causal, so the draws before any
 * date are the same whether or not later history was loaded. Callers slice the
 * result by date instead of rebuilding — see `sliceLedger`. That is what lets
 * one ledger serve a screen showing a dozen periods.
 */
export const buildCostingLedger = cache(async function buildCostingLedger(
  officeId: string,
): Promise<CostingLedger> {
  const [purchaseLines, entries, countLines] = await Promise.all([
    // Every query is explicitly ordered. The replay sorts by day, so ties are
    // broken by the order rows arrive in — and a tie decides who gets billed
    // the fallback price when a pool runs dry mid-day. Left to the database,
    // the same data would settle to different amounts on different runs.
    prisma.purchaseLine.findMany({
      where: { batch: { officeId } },
      orderBy: [{ batchId: "asc" }, { id: "asc" }],
      select: {
        itemId: true,
        qty: true,
        lineTotal: true,
        item: { select: { name: true, sortOrder: true } },
        batch: {
          select: {
            id: true,
            purchasedAt: true,
            deliveredAt: true,
            paidByUserId: true,
            paidBy: { select: { name: true } },
          },
        },
      },
    }),
    prisma.consumptionEntry.findMany({
      where: { officeId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        userId: true,
        itemId: true,
        date: true,
        qty: true,
        cancelledAt: true,
        item: { select: { name: true, sortOrder: true } },
        user: { select: { name: true } },
      },
    }),
    // Shrinkage is read from the counts themselves, not from the INVENTORY
    // stock movements they emit: the count carries the date it was taken, which
    // is what decides the period it is billed to, while the movement only
    // carries when the row was written.
    prisma.stockCountLine.findMany({
      where: { count: { officeId }, delta: { not: 0 } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        itemId: true,
        delta: true,
        item: { select: { name: true, sortOrder: true } },
        count: { select: { countedAt: true } },
      },
    }),
  ]);

  const userNames = new Map<string, string>();
  const itemInfo = new Map<string, { name: string; sortOrder: number }>();
  const events: LedgerEvent[] = [];

  for (const l of purchaseLines) {
    // Cans join the pool when they land in the fridge. An order that has been
    // paid but not yet marked delivered still counts from its purchase date —
    // the money is out, and offices are not always diligent about the button.
    userNames.set(l.batch.paidByUserId, l.batch.paidBy.name);
    itemInfo.set(l.itemId, l.item);
    events.push({
      kind: "PURCHASE",
      at: l.batch.deliveredAt ?? l.batch.purchasedAt,
      itemId: l.itemId,
      qty: l.qty,
      spend: l.lineTotal.toNumber(),
      payerId: l.batch.paidByUserId,
      batchId: l.batch.id,
    });
  }

  for (const e of entries) {
    userNames.set(e.userId, e.user.name);
    itemInfo.set(e.itemId, e.item);
    events.push({
      kind: "CONSUMPTION",
      at: e.date,
      itemId: e.itemId,
      qty: e.qty,
      userId: e.userId,
      entryId: e.id,
    });
    // A cancelled entry is not erased: the can left the fridge on `date` and
    // came back on `cancelledAt`. Modelling it as a draw plus a return is what
    // makes a cancellation land in the period where it happened.
    if (e.cancelledAt) {
      events.push({
        kind: "RETURN",
        at: e.cancelledAt,
        itemId: e.itemId,
        qty: e.qty,
        userId: e.userId,
        entryId: e.id,
      });
    }
  }

  for (const line of countLines) {
    itemInfo.set(line.itemId, line.item);
    events.push({
      kind: "INVENTORY",
      at: line.count.countedAt,
      itemId: line.itemId,
      qty: line.delta,
      sourceId: line.id,
    });
  }

  // Sorted by day, not by timestamp: consumption is date-only in the DB, so a
  // finer sort would order it against deliveries by an accident of storage.
  events.sort(
    (a, b) =>
      dayStart(a.at).getTime() - dayStart(b.at).getTime() ||
      EVENT_ORDER[a.kind] - EVENT_ORDER[b.kind] ||
      a.at.getTime() - b.at.getTime(),
  );

  const pools = new Map<string, Pool>();
  const poolOf = (itemId: string): Pool => {
    let pool = pools.get(itemId);
    if (!pool) {
      pool = { qty: 0, value: 0, payers: new Map() };
      pools.set(itemId, pool);
    }
    return pool;
  };

  /**
   * The blended price of everything still on the shelf.
   *
   * Zero once the pools are empty — deliberately. At that point every franc
   * spent has already been credited back, so a can drawn beyond what was
   * bought is free: charging for it would credit a payer who is already whole,
   * inventing money out of a bookkeeping gap.
   */
  const officeUnitCost = (): number => {
    let qty = 0;
    let value = 0;
    for (const pool of pools.values()) {
      qty += pool.qty;
      value += pool.value;
    }
    return qty > 0 && value > 0 ? value / qty : 0;
  };

  /** Who to credit when the item's own pool cannot answer. */
  const officeShares = (): Map<string, number> => {
    const shares = new Map<string, number>();
    let total = 0;
    for (const pool of pools.values()) {
      for (const [payerId, v] of pool.payers) {
        shares.set(payerId, (shares.get(payerId) ?? 0) + v);
        total += v;
      }
    }
    if (total > 0) {
      for (const [payerId, v] of shares) shares.set(payerId, v / total);
    }
    return shares;
  };

  /** Takes `n` cans out of one pool, crediting its payers pro rata. */
  const drawFromPool = (
    pool: Pool,
    n: number,
    credits: Map<string, number>,
  ): number => {
    const drawn = pool.qty > 0 ? (pool.value / pool.qty) * n : 0;
    if (pool.value > 0) {
      for (const [payerId, v] of pool.payers) {
        // A payer whose francs are all drawn out stays in the map forever
        // otherwise, and every later draw carries a zero credit for them.
        if (v === 0) {
          pool.payers.delete(payerId);
          continue;
        }
        const credit = (v / pool.value) * drawn;
        credits.set(payerId, (credits.get(payerId) ?? 0) + credit);
        pool.payers.set(payerId, v - credit);
      }
    }
    pool.qty -= n;
    pool.value -= drawn;
    return drawn;
  };

  /**
   * Takes `n` cans from the shelf as a whole, split across the pools in
   * proportion to what each still holds.
   *
   * Used when an item's own pool cannot cover a draw. The can came from
   * somewhere, so the money comes out of the office's stock rather than being
   * credited out of thin air — crediting the payers without emptying their
   * pools would credit the same francs twice, once here and again as their own
   * cans are drunk. Each pool gives up quantity and value together, so no
   * pool's unit cost moves.
   *
   * Returns what could actually be taken: with nothing left on the shelf there
   * is nobody to reimburse, and the can is free.
   */
  const drawFromOffice = (
    n: number,
    credits: Map<string, number>,
  ): number => {
    let totalQty = 0;
    for (const pool of pools.values()) totalQty += pool.qty;
    if (totalQty <= 0) return 0;

    const taken = Math.min(n, totalQty);
    let cost = 0;
    for (const pool of pools.values()) {
      if (pool.qty <= 0) continue;
      cost += drawFromPool(pool, (pool.qty / totalQty) * taken, credits);
    }
    return cost;
  };

  /**
   * Takes `n` cans out of an item's pool. Returns what it costs and who gets
   * credited — always the same total, so the books stay balanced.
   */
  const draw = (
    itemId: string,
    n: number,
  ): { cost: number; credits: Map<string, number> } => {
    const pool = poolOf(itemId);
    const credits = new Map<string, number>();
    let cost = 0;

    const covered = Math.max(0, Math.min(n, pool.qty));
    if (covered > 0) cost += drawFromPool(pool, covered, credits);

    const uncovered = n - covered;
    if (uncovered > 0) cost += drawFromOffice(uncovered, credits);

    return { cost, credits };
  };

  /**
   * Puts `n` cans back at `unitCost` each, credited to `shares`. Returns the
   * value actually attributed, which is zero when no payer can be credited —
   * the pool must never hold francs that belong to nobody, or later draws would
   * charge a drinker more than they credit the payers.
   */
  const restore = (
    itemId: string,
    n: number,
    unitCost: number,
    shares: Map<string, number>,
  ): { amount: number; credits: Map<string, number> } => {
    const totalShare = [...shares.values()].reduce((sum, s) => sum + s, 0);
    const credits = new Map<string, number>();
    // Nothing was taken from this pool, so nothing goes back into it. Adding
    // the cans anyway would put valueless quantity in the pool and dilute the
    // moving average for every can bought after it.
    if (totalShare <= 0 || unitCost === 0) return { amount: 0, credits };

    const pool = poolOf(itemId);
    pool.qty += n;
    const amount = n * unitCost;
    pool.value += amount;
    for (const [payerId, share] of shares) {
      const part = (share / totalShare) * amount;
      pool.payers.set(payerId, (pool.payers.get(payerId) ?? 0) + part);
      credits.set(payerId, -part);
    }
    return { amount, credits };
  };

  /**
   * Puts `n` found cans back on the shelf — the mirror of `draw`, for an
   * inventory count that came up long. They enter at the item's own going rate,
   * or at the office blend when the item holds nothing, and the period is
   * credited back what they are worth.
   */
  const refund = (
    itemId: string,
    n: number,
  ): { cost: number; credits: Map<string, number> } => {
    const pool = poolOf(itemId);
    const ownPrice = pool.qty > 0 && pool.value > 0;
    const { amount, credits } = restore(
      itemId,
      n,
      ownPrice ? pool.value / pool.qty : officeUnitCost(),
      ownPrice
        ? new Map([...pool.payers].map(([p, v]) => [p, v / pool.value]))
        : officeShares(),
    );
    return { cost: -amount, credits };
  };

  const draws: CostDraw[] = [];
  const priceHistory: PricePoint[] = [];
  const officePriceHistory: { at: Date; unitCost: number }[] = [];
  /** How a consumption was charged, so its cancellation can undo it exactly. */
  const drawnEntries = new Map<
    string,
    { unitCost: number; shares: Map<string, number> }
  >();

  for (const ev of events) {
    switch (ev.kind) {
      case "PURCHASE": {
        const pool = poolOf(ev.itemId);
        pool.qty += ev.qty;
        pool.value += ev.spend;
        pool.payers.set(
          ev.payerId,
          (pool.payers.get(ev.payerId) ?? 0) + ev.spend,
        );
        priceHistory.push({
          at: ev.at,
          itemId: ev.itemId,
          unitCost: pool.qty > 0 ? pool.value / pool.qty : 0,
          qty: ev.qty,
          spend: ev.spend,
          batchId: ev.batchId,
        });
        officePriceHistory.push({ at: ev.at, unitCost: officeUnitCost() });
        break;
      }

      case "CONSUMPTION": {
        const { cost, credits } = draw(ev.itemId, ev.qty);
        // Remember the exact price and split, so a later cancellation reverses
        // this draw rather than approximating it at today's price.
        const shares = new Map<string, number>();
        if (cost !== 0) {
          for (const [payerId, c] of credits) shares.set(payerId, c / cost);
        }
        drawnEntries.set(ev.entryId, {
          unitCost: ev.qty > 0 ? cost / ev.qty : 0,
          shares,
        });
        draws.push({
          kind: "CONSUMPTION",
          at: ev.at,
          itemId: ev.itemId,
          qty: ev.qty,
          cost,
          credits,
          userId: ev.userId,
          sourceId: ev.entryId,
        });
        break;
      }

      case "RETURN": {
        // Undo the exact draw this entry made, at the price it was drawn at.
        const drawn = drawnEntries.get(ev.entryId);
        const unitCost = drawn?.unitCost ?? officeUnitCost();
        const shares = drawn?.shares ?? officeShares();
        const { amount, credits } = restore(ev.itemId, ev.qty, unitCost, shares);
        draws.push({
          kind: "RETURN",
          at: ev.at,
          itemId: ev.itemId,
          qty: -ev.qty,
          cost: -amount,
          credits,
          userId: ev.userId,
          sourceId: ev.entryId,
        });
        break;
      }

      case "INVENTORY": {
        // A shortfall is drawn from the pool like a consumption; a surplus is
        // the same movement with the signs flipped, so both produce one draw.
        const { cost, credits } =
          ev.qty < 0 ? draw(ev.itemId, -ev.qty) : refund(ev.itemId, ev.qty);

        draws.push({
          kind: "SHRINKAGE",
          at: ev.at,
          itemId: ev.itemId,
          qty: -ev.qty,
          cost,
          credits,
          sourceId: ev.sourceId,
        });
        break;
      }
    }
  }

  const ordered = [...itemInfo].sort(
    ([, a], [, b]) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

  return {
    draws,
    priceHistory,
    priceAt: buildPriceIndex(priceHistory, officePriceHistory),
    userNames,
    itemNames: new Map(ordered.map(([id, info]) => [id, info.name])),
  };
});

/** A price curve: unit cost from `day` (a UTC day number) until the next entry. */
interface PriceStep {
  day: number;
  unitCost: number;
}

/**
 * Builds the price lookup as a standalone function of two arrays, rather than a
 * closure over the replay. The replay's pools, events and rows are then
 * collectable as soon as the ledger is returned, and what the lookup retains is
 * exactly what you can see here.
 */
function buildPriceIndex(
  priceHistory: PricePoint[],
  officePriceHistory: { at: Date; unitCost: number }[],
): (itemId: string, at: Date) => ItemPriceAt {
  // Day numbers are precomputed and same-day entries collapsed to the last:
  // an order of several lines moves the price once, not once per line, and the
  // lookup is called per item per chart point, where rebuilding a Date per
  // comparison dominated it.
  const toSteps = (points: { at: Date; unitCost: number }[]): PriceStep[] => {
    const steps: PriceStep[] = [];
    for (const p of points) {
      const day = dayStart(p.at).getTime();
      const last = steps[steps.length - 1];
      if (last && last.day === day) last.unitCost = p.unitCost;
      else steps.push({ day, unitCost: p.unitCost });
    }
    return steps;
  };

  const office = toSteps(officePriceHistory);

  const pointsByItem = new Map<string, { at: Date; unitCost: number }[]>();
  for (const p of priceHistory) {
    const points = pointsByItem.get(p.itemId) ?? [];
    points.push(p);
    pointsByItem.set(p.itemId, points);
  }
  const byItem = new Map(
    [...pointsByItem].map(([itemId, points]) => [itemId, toSteps(points)]),
  );

  // Prices only move on deliveries, so "the price on day D" is the last
  // delivery on or before D. Deliveries land in the morning in the replay, so a
  // same-day delivery counts — which also means a caller passing a date-only
  // value (a period's endDate, say) gets the end of that day.
  const stepLookup = (steps: PriceStep[], day: number): number => {
    let value = 0;
    for (const step of steps) {
      if (step.day > day) break;
      value = step.unitCost;
    }
    return value;
  };

  return (itemId, at) => {
    const day = dayStart(at).getTime();
    const steps = byItem.get(itemId);
    // Before an item's first delivery it has no price of its own, so it is
    // billed — and charted — at the office-wide blend.
    if (!steps || steps.length === 0 || steps[0].day > day) {
      return { unitCost: stepLookup(office, day), estimated: true };
    }
    return { unitCost: stepLookup(steps, day), estimated: false };
  };
}
