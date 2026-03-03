"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import {
  uploadToR2,
  buildInvoiceKey,
  getR2SignedUrl,
  deleteFromR2,
} from "@/lib/r2-helpers";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const CreatePurchaseSchema = z.object({
  purchasedAt: z.coerce.date(),
  paidByUserId: z.string().min(1, "Paid by is required"),
  qty: z.coerce.number().int().positive("Qty must be positive"),
  totalPrice: z.coerce.number().positive("Total must be positive"),
  notes: z.string().max(500).optional().or(z.literal("")),
});

type ActionResult = { success: true } | { success: false; error: string };

export async function createPurchaseBatch(
  officeId: string,
  formData: FormData
): Promise<ActionResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");

  const parsed = CreatePurchaseSchema.safeParse({
    purchasedAt: formData.get("purchasedAt"),
    paidByUserId: formData.get("paidByUserId"),
    qty: formData.get("qty"),
    totalPrice: formData.get("totalPrice"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { purchasedAt, paidByUserId, qty, totalPrice, notes } = parsed.data;
  const unitPrice = Math.round((totalPrice / qty) * 100) / 100;

  // Extract and validate files
  const files = formData.getAll("invoices") as File[];
  const validFiles = files.filter((f) => f.size > 0);

  for (const file of validFiles) {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return {
        success: false,
        error: `Invalid file type: ${file.name}. Allowed: PDF, PNG, JPG.`,
      };
    }
    if (file.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `File too large: ${file.name}. Max 10MB.`,
      };
    }
  }

  const batchId = crypto.randomUUID();
  const uploadedKeys: string[] = [];

  try {
    // Upload files to R2 first
    const invoiceRecords: {
      storageKey: string;
      filename: string;
      mimeType: string;
    }[] = [];

    for (const file of validFiles) {
      const key = buildInvoiceKey(batchId, file.name);
      const buffer = Buffer.from(await file.arrayBuffer());
      await uploadToR2({ key, body: buffer, contentType: file.type });
      uploadedKeys.push(key);
      invoiceRecords.push({
        storageKey: key,
        filename: file.name,
        mimeType: file.type,
      });
    }

    // Create purchase as ORDERED — stock is added when marked as delivered
    await prisma.purchaseBatch.create({
      data: {
        id: batchId,
        officeId,
        status: "ORDERED",
        purchasedAt,
        orderedByUserId: membership.userId,
        paidByUserId,
        qty,
        unitPrice,
        totalPrice,
        notes: notes || null,
        invoices: {
          create: invoiceRecords,
        },
      },
    });
  } catch (e) {
    // Cleanup orphan uploads on failure
    await Promise.allSettled(uploadedKeys.map(deleteFromR2));
    throw e;
  }

  revalidatePath(`/org/${officeId}/admin/purchases`);
  revalidatePath(`/org/${officeId}/admin/stock`);
  return { success: true };
}

export async function markDelivered(
  officeId: string,
  batchId: string
): Promise<ActionResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");

  const batch = await prisma.purchaseBatch.findUnique({
    where: { id: batchId },
  });

  if (!batch || batch.officeId !== officeId) {
    return { success: false, error: "Purchase not found." };
  }

  if (batch.status === "DELIVERED") {
    return { success: false, error: "Already marked as delivered." };
  }

  const stock = await prisma.stock.findUnique({ where: { officeId } });
  const newQty = (stock?.currentQty ?? 0) + batch.qty;

  await prisma.$transaction([
    prisma.purchaseBatch.update({
      where: { id: batchId },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    }),
    prisma.stockMovement.create({
      data: {
        officeId,
        delta: batch.qty,
        reason: "PURCHASE",
        note: `Delivery received: ${batch.qty} units`,
        userId: membership.userId,
      },
    }),
    prisma.stock.upsert({
      where: { officeId },
      create: { officeId, currentQty: batch.qty },
      update: { currentQty: newQty },
    }),
  ]);

  // Stock increased — reset low stock alert if applicable
  checkAndAlertLowStock(officeId).catch(() => {});

  revalidatePath(`/org/${officeId}/admin/purchases`);
  revalidatePath(`/org/${officeId}/admin/stock`);
  return { success: true };
}

export async function getInvoiceUrl(
  officeId: string,
  invoiceFileId: string
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  await requireOrgRoles(officeId, "ADMIN");

  const invoice = await prisma.invoiceFile.findUnique({
    where: { id: invoiceFileId },
    include: {
      purchaseBatch: { select: { officeId: true } },
    },
  });

  if (!invoice || invoice.purchaseBatch.officeId !== officeId) {
    return { success: false, error: "Invoice not found." };
  }

  const url = await getR2SignedUrl(invoice.storageKey);
  return { success: true, url };
}
