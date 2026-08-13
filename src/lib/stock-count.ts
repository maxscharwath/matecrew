import { prisma } from "@/lib/prisma";
import { sumStockQty } from "@/lib/items";
import { stockDeltaOps } from "@/lib/stock";
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

/** Thrown inside the transaction so Prisma rolls back; caught at the boundary. */
class UnknownItemError extends Error {
  constructor(readonly itemId: string) {
    super(`Unknown item ${itemId}`);
  }
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

  // Expected quantities are read inside the transaction that writes the gap.
  // A round served between the read and the write would otherwise be billed as
  // shrinkage and deducted from stock a second time.
  let outcome: { lines: CountedLine[]; gaps: CountedLine[] };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const items = await tx.item.findMany({
        where: { officeId, id: { in: [...seen] } },
        select: { id: true, name: true, stock: { select: { currentQty: true } } },
      });
      const byId = new Map(items.map((i) => [i.id, i]));

      const lines: CountedLine[] = [];
      for (const c of counts) {
        const item = byId.get(c.itemId);
        if (!item) throw new UnknownItemError(c.itemId);
        const expectedQty = sumStockQty(item.stock);
        lines.push({
          itemId: item.id,
          itemName: item.name,
          expectedQty,
          countedQty: c.countedQty,
          delta: gapOf(expectedQty, c.countedQty),
        });
      }

      const gaps = lines.filter((l) => l.delta !== 0);

      await tx.stockCount.create({
        data: {
          officeId,
          countedAt,
          countedByUserId: userId,
          note,
          lines: {
            create: lines.map((l) => ({
              itemId: l.itemId,
              expectedQty: l.expectedQty,
              countedQty: l.countedQty,
              delta: l.delta,
            })),
          },
        },
      });
      await Promise.all(
        gaps.flatMap((l) =>
          stockDeltaOps({
            officeId,
            itemId: l.itemId,
            delta: l.delta,
            reason: "INVENTORY",
            note,
            userId,
            client: tx,
          }),
        ),
      );

      return { lines, gaps };
    });
  } catch (e) {
    if (e instanceof UnknownItemError) {
      return { ok: false, reason: "unknown_item", itemId: e.itemId };
    }
    throw e;
  }

  const { lines, gaps } = outcome;
  return { ok: true, result: { lines, gaps, ...summarizeGaps(gaps) } };
}
