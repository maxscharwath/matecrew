"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";

const AdjustStockSchema = z.object({
  adjustment: z.coerce.number().int().refine((n) => n !== 0, "Cannot be zero"),
  note: z.string().max(200).optional().or(z.literal("")),
});

type ActionResult = { success: true } | { success: false; error: string };

export async function adjustStock(
  officeId: string,
  formData: FormData
): Promise<ActionResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");

  const parsed = AdjustStockSchema.safeParse({
    adjustment: formData.get("adjustment"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { adjustment, note } = parsed.data;

  const stock = await prisma.stock.findUnique({ where: { officeId } });

  if (!stock) {
    return { success: false, error: "Stock record not found for this office." };
  }

  const newQty = stock.currentQty + adjustment;
  if (newQty < 0) {
    return {
      success: false,
      error: `Cannot reduce below 0. Current: ${stock.currentQty}, adjustment: ${adjustment}.`,
    };
  }

  await prisma.$transaction([
    prisma.stockMovement.create({
      data: {
        officeId,
        delta: adjustment,
        reason: "ADJUSTMENT",
        note: note || null,
        userId: membership.userId,
      },
    }),
    prisma.stock.update({
      where: { officeId },
      data: { currentQty: newQty },
    }),
  ]);

  checkAndAlertLowStock(officeId).catch(() => {});

  revalidatePath(`/org/${officeId}/admin/stock`);
  return { success: true };
}
