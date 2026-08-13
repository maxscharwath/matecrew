import type { Prisma, StockMovementReason } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Either the client or an interactive `$transaction` handle. */
type StockClient = Pick<
  Prisma.TransactionClient,
  "stockMovement" | "stock"
>;

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
 *
 * Pass `client` to issue the same writes inside an interactive transaction,
 * where they run immediately rather than being collected:
 *
 *   await prisma.$transaction(async (tx) => {
 *     await Promise.all(stockDeltaOps({ ..., client: tx }));
 *   });
 */
export function stockDeltaOps(opts: {
  officeId: string;
  itemId: string;
  delta: number;
  reason: StockMovementReason;
  note?: string | null;
  userId?: string | null;
  client?: StockClient;
}) {
  const {
    officeId,
    itemId,
    delta,
    reason,
    note = null,
    userId = null,
    client = prisma,
  } = opts;
  return [
    client.stockMovement.create({
      data: { officeId, itemId, delta, reason, note, userId },
    }),
    client.stock.upsert({
      where: { officeId_itemId: { officeId, itemId } },
      create: { officeId, itemId, currentQty: delta },
      update: { currentQty: { increment: delta } },
    }),
  ];
}
