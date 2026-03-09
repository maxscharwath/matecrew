"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";

type ActionResult = { success: true; count: number } | { success: false; error: string };

interface ConsumptionRow {
  userId: string;
  date: string; // ISO date string YYYY-MM-DD
  qty: number;
  deductStock: boolean;
}

export async function bulkCreateConsumption(
  officeId: string,
  rows: ConsumptionRow[],
): Promise<ActionResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  if (rows.length === 0) {
    return { success: false, error: t("bulkConsumption.noRows") };
  }

  // Validate all rows
  const memberIds = new Set(
    (
      await prisma.membership.findMany({
        where: { officeId },
        select: { userId: true },
      })
    ).map((m) => m.userId),
  );

  let stockDeductQty = 0;
  for (const row of rows) {
    if (!memberIds.has(row.userId)) {
      return { success: false, error: t("errors.userNotFound") };
    }
    if (row.qty < 1) {
      return { success: false, error: t("errors.qtyMustBePositive") };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      return { success: false, error: t("bulkConsumption.invalidDate") };
    }
    if (row.deductStock) {
      stockDeductQty += row.qty;
    }
  }

  // Check stock if any rows deduct
  if (stockDeductQty > 0) {
    const stock = await prisma.stock.findUnique({ where: { officeId } });
    const currentQty = stock?.currentQty ?? 0;
    if (stockDeductQty > currentQty) {
      return {
        success: false,
        error: t("errors.cannotReduceBelowZero", {
          current: currentQty,
          adjustment: -stockDeductQty,
        }),
      };
    }
  }

  // Build transaction: consumption entries + optional stock ops
  const consumptionOps = rows.map((row) =>
    prisma.consumptionEntry.create({
      data: {
        officeId,
        userId: row.userId,
        date: new Date(row.date),
        qty: row.qty,
        source: "MANUAL",
      },
    }),
  );

  if (stockDeductQty > 0) {
    const deductRows = rows.filter((r) => r.deductStock);
    await prisma.$transaction([
      ...consumptionOps,
      prisma.stockMovement.create({
        data: {
          officeId,
          delta: -stockDeductQty,
          reason: "SERVED",
          note: `Bulk consumption (${deductRows.length} entries)`,
          userId: membership.userId,
        },
      }),
      prisma.stock.update({
        where: { officeId },
        data: { currentQty: { decrement: stockDeductQty } },
      }),
    ]);
  } else {
    await prisma.$transaction(consumptionOps);
  }

  revalidatePath(`/org/${officeId}/admin/consumption`);
  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/admin/stock`);
  revalidatePath(`/org/${officeId}/dashboard`);

  return { success: true, count: rows.length };
}
