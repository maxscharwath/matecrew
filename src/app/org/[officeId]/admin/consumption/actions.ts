"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { stockDeltaOps } from "@/lib/stock";

type ActionResult = { success: true; count: number } | { success: false; error: string };

interface ConsumptionRow {
  userId: string;
  itemId?: string | null;
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

  const [memberships, officeItems] = await Promise.all([
    prisma.membership.findMany({ where: { officeId }, select: { userId: true } }),
    prisma.item.findMany({ where: { officeId }, select: { id: true, isDefault: true } }),
  ]);
  const memberIds = new Set(memberships.map((m) => m.userId));
  const itemIds = new Set(officeItems.map((i) => i.id));
  const defaultItemId = officeItems.find((i) => i.isDefault)?.id ?? null;

  // Resolve each row's item (falling back to the office default) and validate.
  const resolved: (ConsumptionRow & { resolvedItemId: string })[] = [];
  // qty to deduct from stock, per item
  const deductByItem = new Map<string, number>();

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
    const resolvedItemId = row.itemId ?? defaultItemId;
    if (!resolvedItemId || !itemIds.has(resolvedItemId)) {
      return { success: false, error: t("errors.itemNotFound") };
    }
    resolved.push({ ...row, resolvedItemId });
    if (row.deductStock) {
      deductByItem.set(
        resolvedItemId,
        (deductByItem.get(resolvedItemId) ?? 0) + row.qty,
      );
    }
  }

  // Check per-item stock sufficiency before writing anything.
  if (deductByItem.size > 0) {
    const stocks = await prisma.stock.findMany({
      where: { officeId, itemId: { in: [...deductByItem.keys()] } },
      select: { itemId: true, currentQty: true },
    });
    const qtyByItem = new Map(stocks.map((s) => [s.itemId, s.currentQty]));
    for (const [itemId, deduct] of deductByItem) {
      const currentQty = qtyByItem.get(itemId) ?? 0;
      if (deduct > currentQty) {
        return {
          success: false,
          error: t("errors.cannotReduceBelowZero", {
            current: currentQty,
            adjustment: -deduct,
          }),
        };
      }
    }
  }

  const consumptionOps = resolved.map((row) =>
    prisma.consumptionEntry.create({
      data: {
        officeId,
        userId: row.userId,
        itemId: row.resolvedItemId,
        date: new Date(row.date),
        qty: row.qty,
        source: "MANUAL",
      },
    }),
  );

  const stockOps = [...deductByItem.entries()].flatMap(([itemId, deduct]) =>
    stockDeltaOps({
      officeId,
      itemId,
      delta: -deduct,
      reason: "SERVED",
      note: `Bulk consumption (${deduct})`,
      userId: membership.userId,
    }),
  );

  await prisma.$transaction([...consumptionOps, ...stockOps]);

  revalidatePath(`/org/${officeId}/admin/consumption`);
  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/admin/stock`);
  revalidatePath(`/org/${officeId}/dashboard`);

  return { success: true, count: rows.length };
}
