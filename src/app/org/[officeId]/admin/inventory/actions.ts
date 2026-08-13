"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgRoles } from "@/lib/auth-utils";
import { checkAndAlertLowStockMany } from "@/lib/stock-alerts";
import { recordStockCount, type StockCountResult } from "@/lib/stock-count";
import { getTranslations } from "next-intl/server";

type ActionResult =
  | { success: true; result: Pick<StockCountResult, "missing" | "surplus"> }
  | { success: false; error: string };

/**
 * Records a physical count of the fridge.
 *
 * The gap between what was counted and what the app believed is the office's
 * shrinkage, and it is not free: `@/lib/costing` bills it to the period's
 * drinkers. That is the whole point — without a count, missing cans are paid
 * for by whoever bought the last order and nobody ever sees it.
 */
export async function recordCount(
  officeId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const CountSchema = z.object({
    counts: z
      .array(
        z.object({
          itemId: z.string().min(1),
          // Bounded: a mistyped count writes phantom cans straight into the
          // value pool and rewrites the office's prices.
          countedQty: z.coerce.number().int().min(0).max(10_000),
        }),
      )
      .min(1, t("inventory.errors.noItems")),
    note: z.string().max(200).optional().or(z.literal("")),
  });

  let rawCounts: unknown;
  try {
    rawCounts = JSON.parse(String(formData.get("counts") ?? "[]"));
  } catch {
    return { success: false, error: t("inventory.errors.noItems") };
  }

  const parsed = CountSchema.safeParse({
    counts: rawCounts,
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const outcome = await recordStockCount({
    officeId,
    userId: membership.userId,
    counts: parsed.data.counts,
    note: parsed.data.note || null,
  });

  if (!outcome.ok) {
    return { success: false, error: t("errors.itemNotFound") };
  }

  checkAndAlertLowStockMany(
    officeId,
    outcome.result.gaps.map((g) => g.itemId),
  );

  revalidatePath(`/org/${officeId}/admin/inventory`);
  revalidatePath(`/org/${officeId}/admin/stock`);
  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  // A count moves what members owe, so their own screens are stale too.
  revalidatePath(`/org/${officeId}/reimbursements`);
  revalidatePath(`/org/${officeId}/dashboard`);

  const { missing, surplus } = outcome.result;
  return { success: true, result: { missing, surplus } };
}
