import { commitBatch, newId, prisma, retryOnConflict } from "@/lib/prisma";
import { sumStockQty } from "@/lib/items";
import { stockDeltaOps, stockUnchanged } from "@/lib/stock";
import { gapOf, summarizeGaps } from "@/lib/stock-gaps";

/**
 * Recording a physical count of the fridge.
 *
 * A count moves money — the cans it finds missing are billed as shrinkage to
 * the period's drinkers — so, like `@/lib/reimbursement-periods`, the write
 * lives here rather than being written once for the admin screen and once for
 * the MCP tool. Two copies would eventually bill two different amounts for the
 * same fridge.
 *
 * The count row is the record of what happened; the INVENTORY stock movements
 * are its effect on the shelf. `@/lib/costing` reads the former, because only
 * it carries `countedAt` — the date that decides which period pays.
 */

interface CountedItem {
  itemId: string;
  countedQty: number;
}

interface CountedLine {
  itemId: string;
  itemName: string;
  expectedQty: number;
  countedQty: number;
  /** countedQty - expectedQty: negative is shrinkage, positive a surplus. */
  delta: number;
}

export interface StockCountResult {
  lines: CountedLine[];
  /** Lines that did not match. */
  gaps: CountedLine[];
  /** Cans missing across all items. */
  missing: number;
  /** Cans found that the app did not know about. */
  surplus: number;
}

type RecordStockCountResult =
  | { ok: true; result: StockCountResult }
  | { ok: false; reason: "unknown_item" | "duplicate_item"; itemId: string };

interface ReadLine extends CountedLine {
  /** The pool level the line was computed from; undefined when the item had no pool row. */
  readonly readQty: number | undefined;
}

/**
 * Reconciles counted quantities against the office's stock and, for every line
 * that does not match, moves the stock and records the gap.
 *
 * Expected quantities are read here rather than trusted from the caller: the
 * page that rendered the count sheet may be minutes old, and the gap being
 * billed has to be measured against what the app believes right now.
 */
export async function recordStockCount(opts: {
  officeId: string;
  userId: string;
  counts: CountedItem[];
  note?: string | null;
  /** Defaults to now. The period that contains it is the one that pays. */
  countedAt?: Date;
}): Promise<RecordStockCountResult> {
  const { officeId, userId, counts, note = null, countedAt = new Date() } = opts;

  const seen = new Set<string>();
  for (const c of counts) {
    if (seen.has(c.itemId)) {
      return { ok: false, reason: "duplicate_item", itemId: c.itemId };
    }
    seen.add(c.itemId);
  }

  // Expected quantities are read, the gaps computed, then the count, its lines
  // and the stock movements are written in one atomic batch. Its guards require
  // every pool with a gap to still be at the level read: a round served in
  // between would otherwise be billed as shrinkage and deducted from stock a
  // second time. Then the batch is rolled back and the count reconciled again.
  const outcome = await retryOnConflict(() => reconcile(officeId, userId, counts, note, countedAt));
  if ("unknownItemId" in outcome) {
    return { ok: false, reason: "unknown_item", itemId: outcome.unknownItemId };
  }

  const { lines, gaps } = outcome;
  return { ok: true, result: { lines, gaps, ...summarizeGaps(gaps) } };
}

/** One read-compute-commit pass of `recordStockCount`. */
async function reconcile(
  officeId: string,
  userId: string,
  counts: readonly CountedItem[],
  note: string | null,
  countedAt: Date,
): Promise<{ lines: CountedLine[]; gaps: CountedLine[] } | { unknownItemId: string }> {
  const items = await prisma.item.findMany({
    where: { officeId, id: { in: counts.map((c) => c.itemId) } },
    select: { id: true, name: true, stock: { where: { officeId }, select: { currentQty: true } } },
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  const read: ReadLine[] = [];
  for (const c of counts) {
    const item = byId.get(c.itemId);
    if (!item) return { unknownItemId: c.itemId };
    const expectedQty = sumStockQty(item.stock);
    read.push({
      itemId: item.id,
      itemName: item.name,
      expectedQty,
      countedQty: c.countedQty,
      delta: gapOf(expectedQty, c.countedQty),
      readQty: item.stock.length === 0 ? undefined : expectedQty,
    });
  }

  const gapsRead = read.filter((l) => l.delta !== 0);
  const countId = newId();
  await commitBatch((db) => [
    ...gapsRead.map((l) => stockUnchanged(db, officeId, l.itemId, l.readQty)),
    db.stockCount.createMany({
      data: [{ id: countId, officeId, countedAt, countedByUserId: userId, note }],
    }),
    db.stockCountLine.createMany({
      data: read.map((l) => ({
        countId,
        itemId: l.itemId,
        expectedQty: l.expectedQty,
        countedQty: l.countedQty,
        delta: l.delta,
      })),
    }),
    ...gapsRead.flatMap((l) =>
      stockDeltaOps(db, {
        officeId,
        itemId: l.itemId,
        delta: l.delta,
        reason: "INVENTORY",
        note,
        userId,
      }),
    ),
  ]);

  const lines = read.map(
    (l): CountedLine => ({
      itemId: l.itemId,
      itemName: l.itemName,
      expectedQty: l.expectedQty,
      countedQty: l.countedQty,
      delta: l.delta,
    }),
  );
  return { lines, gaps: lines.filter((l) => l.delta !== 0) };
}
