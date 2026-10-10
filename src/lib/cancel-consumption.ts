import { BatchConflictError, commitBatch, expectRows, prisma } from "@/lib/prisma";
import { stockDeltaOps } from "@/lib/stock";

export type CancelOutcome = "cancelled" | "not_found" | "not_yours" | "already_cancelled";

/**
 * Cancels one of a member's consumptions, as the member does from the site or a badge terminal:
 * the entry stays in the history marked cancelled, and its can goes back into the stock, which
 * also takes what it cost out of the member's bill (lib/costing.ts). Only their own entries,
 * not cancelled yet.
 */
export async function cancelConsumptionEntry({
  officeId,
  userId,
  entryId,
  note,
}: {
  officeId: string;
  userId: string;
  entryId: string;
  note: string;
}): Promise<CancelOutcome> {
  const entry = await prisma.consumptionEntry.findUnique({ where: { id: entryId } });
  if (entry?.officeId !== officeId) return "not_found";
  if (entry.userId !== userId) return "not_yours";
  if (entry.cancelledAt) return "already_cancelled";

  // Read above, one atomic batch here. The guard only cancels an entry that is
  // still live, so a double tap cannot put its can back twice.
  try {
    await commitBatch((db) => [
      expectRows(
        db.consumptionEntry.updateMany({
          where: { id: entryId, cancelledAt: null },
          data: { cancelledAt: new Date() },
        }),
        1,
      ),
      ...stockDeltaOps(db, { officeId, itemId: entry.itemId, delta: entry.qty, reason: "UNSERVED", note, userId }),
    ]);
  } catch (error) {
    if (error instanceof BatchConflictError) return "already_cancelled";
    throw error;
  }
  return "cancelled";
}
