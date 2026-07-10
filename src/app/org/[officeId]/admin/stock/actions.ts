"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { stockDeltaOps } from "@/lib/stock";
import { getTranslations } from "next-intl/server";

type ActionResult = { success: true } | { success: false; error: string };

export async function adjustStock(
  officeId: string,
  formData: FormData
): Promise<ActionResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const AdjustStockSchema = z.object({
    itemId: z.string().min(1, t('errors.itemNotFound')),
    adjustment: z.coerce.number().int().refine((n) => n !== 0, t('errors.cannotBeZero')),
    note: z.string().max(200).optional().or(z.literal("")),
  });

  const parsed = AdjustStockSchema.safeParse({
    itemId: formData.get("itemId"),
    adjustment: formData.get("adjustment"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { itemId, adjustment, note } = parsed.data;

  const item = await prisma.item.findFirst({
    where: { id: itemId, officeId },
    select: { id: true },
  });
  if (!item) {
    return { success: false, error: t('errors.itemNotFound') };
  }

  const stock = await prisma.stock.findUnique({
    where: { officeId_itemId: { officeId, itemId } },
  });

  const currentQty = stock?.currentQty ?? 0;
  const newQty = currentQty + adjustment;
  if (newQty < 0) {
    return {
      success: false,
      error: t('errors.cannotReduceBelowZero', { current: currentQty, adjustment }),
    };
  }

  await prisma.$transaction(
    stockDeltaOps({
      officeId,
      itemId,
      delta: adjustment,
      reason: "ADJUSTMENT",
      note: note || null,
      userId: membership.userId,
    }),
  );

  checkAndAlertLowStock(officeId, itemId).catch(() => {});

  revalidatePath(`/org/${officeId}/admin/stock`);
  return { success: true };
}
