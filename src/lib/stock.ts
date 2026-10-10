import type { StockMovementReason } from "@/generated/prisma/client";
import { expectRows, type BatchClient, type BatchStep } from "@/platform";

export interface StockDelta {
  readonly officeId: string;
  readonly itemId: string;
  readonly delta: number;
  readonly reason: StockMovementReason;
  readonly note?: string | null;
  readonly userId?: string | null;
}

/**
 * Batch writes that apply a stock delta for one (office, item): add `delta`
 * to the `Stock` pool, creating it for an item nobody has stocked yet, and
 * record the `StockMovement`. Spread them into the caller's batch so they
 * commit with its other writes, or not at all:
 *
 *   await commitBatch((db) => [
 *     ...otherWrites(db),
 *     ...stockDeltaOps(db, { officeId, itemId, delta: -1, reason: "SERVED", userId }),
 *   ]);
 *
 * The pool is one upsert statement (`ON CONFLICT ... DO UPDATE`, standard on
 * SQLite and Postgres) that increments in SQL, so nothing is read first and
 * concurrent deltas add up. It comes first: the movement's foreign key needs
 * the row. `updatedAt` is written explicitly because raw SQL bypasses
 * Prisma's `@updatedAt`.
 */
export function stockDeltaOps(db: BatchClient, change: StockDelta, now: Date = new Date()) {
  const { officeId, itemId, delta, reason, note = null, userId = null } = change;
  return [
    db.$executeRaw`INSERT INTO "Stock" ("officeId", "itemId", "currentQty", "updatedAt")
      VALUES (${officeId}, ${itemId}, ${delta}, ${now})
      ON CONFLICT ("officeId", "itemId")
      DO UPDATE SET "currentQty" = "Stock"."currentQty" + excluded."currentQty", "updatedAt" = excluded."updatedAt"`,
    db.stockMovement.createMany({
      data: [{ officeId, itemId, delta, reason, note, userId, createdAt: now }],
    }),
  ];
}

/**
 * Batch guard: the (office, item) pool still holds at least `qty` cans, as
 * read before the batch was built. Put it before the batch's stock deltas. It
 * matches the pool row only while that holds; otherwise it touches nothing
 * and the whole batch is rolled back with `BatchConflictError("guard")`, so a
 * concurrent take cannot drive the pool below zero.
 */
export function stockAtLeast(db: BatchClient, officeId: string, itemId: string, qty: number): BatchStep {
  return expectRows(
    db.stock.updateMany({
      where: { officeId, itemId, currentQty: { gte: qty } },
      data: { currentQty: { increment: 0 } },
    }),
    1,
  );
}

/**
 * Batch guard: the (office, item) pool is still at the level read before the
 * batch was built, `undefined` meaning it had no row yet; same rules as
 * `stockAtLeast`. For writes computed from the exact level (a count, a
 * correction to a target).
 */
export function stockUnchanged(
  db: BatchClient,
  officeId: string,
  itemId: string,
  readQty: number | undefined,
): BatchStep {
  // A missing row must still be missing (no row touched); an existing one must hold the same count.
  const where = readQty === undefined ? { officeId, itemId } : { officeId, itemId, currentQty: readQty };
  return expectRows(db.stock.updateMany({ where, data: { currentQty: { increment: 0 } } }), readQty === undefined ? 0 : 1);
}

/**
 * The threshold that decides whether an item counts as low: its own when it
 * has one, the office's otherwise.
 *
 * One function rather than `?? office.lowStockThreshold` sprinkled around,
 * because the fallback has to read the same way everywhere — an alert that
 * fires on the item's number while a screen still paints "ok" from the
 * office's is worse than having no per-item threshold at all.
 */
export function effectiveLowStockThreshold(
  itemThreshold: number | null | undefined,
  officeThreshold: number,
): number {
  return itemThreshold ?? officeThreshold;
}
