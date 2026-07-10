import { prisma } from "@/lib/prisma";

type StockMovementReason = "SERVED" | "UNSERVED" | "ADJUSTMENT" | "PURCHASE";

/**
 * Prisma operations that apply a stock delta for one (office, item): records a
 * `StockMovement` and upserts the `Stock` pool (atomic increment/decrement, so
 * no pre-read is needed). Spread the returned pair into a `$transaction` so it
 * can be batched with the caller's other writes:
 *
 *   await prisma.$transaction([
 *     ...otherOps,
 *     ...stockDeltaOps({ officeId, itemId, delta: -1, reason: "SERVED", userId }),
 *   ]);
 */
export function stockDeltaOps(opts: {
  officeId: string;
  itemId: string;
  delta: number;
  reason: StockMovementReason;
  note?: string | null;
  userId?: string | null;
}) {
  const { officeId, itemId, delta, reason, note = null, userId = null } = opts;
  return [
    prisma.stockMovement.create({
      data: { officeId, itemId, delta, reason, note, userId },
    }),
    prisma.stock.upsert({
      where: { officeId_itemId: { officeId, itemId } },
      create: { officeId, itemId, currentQty: delta },
      update: { currentQty: { increment: delta } },
    }),
  ];
}
