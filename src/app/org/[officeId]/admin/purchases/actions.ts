"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import {
  uploadFile,
  buildInvoiceKey,
  internalFileUrl,
  deleteFile,
} from "@/lib/storage";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { stockDeltaOps } from "@/lib/stock";
import { getTranslations } from "next-intl/server";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

type ActionResult = { success: true } | { success: false; error: string };

export async function createPurchaseBatch(
  officeId: string,
  formData: FormData
): Promise<ActionResult> {
  const { membership } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const LineSchema = z.object({
    itemId: z.string().min(1, t('errors.itemNotFound')),
    qty: z.coerce.number().int().positive(t('errors.qtyMustBePositive')),
    total: z.coerce.number().positive(t('errors.totalMustBePositive')),
  });

  const CreatePurchaseSchema = z.object({
    purchasedAt: z.coerce.date(),
    paidByUserId: z.string().min(1, t('errors.paidByRequired')),
    notes: z.string().max(500).optional().or(z.literal("")),
    lines: z.array(LineSchema).min(1, t('errors.qtyMustBePositive')),
  });

  let parsedLines: unknown;
  try {
    parsedLines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    parsedLines = [];
  }

  const parsed = CreatePurchaseSchema.safeParse({
    purchasedAt: formData.get("purchasedAt"),
    paidByUserId: formData.get("paidByUserId"),
    notes: formData.get("notes"),
    lines: parsedLines,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { purchasedAt, paidByUserId, notes, lines } = parsed.data;

  // Every line's item must belong to this office.
  const officeItemIds = new Set(
    (
      await prisma.item.findMany({
        where: { officeId, id: { in: lines.map((l) => l.itemId) } },
        select: { id: true },
      })
    ).map((i) => i.id),
  );
  if (lines.some((l) => !officeItemIds.has(l.itemId))) {
    return { success: false, error: t('errors.itemNotFound') };
  }

  const lineData = lines.map((l) => ({
    itemId: l.itemId,
    qty: l.qty,
    unitPrice: Math.round((l.total / l.qty) * 100) / 100,
    lineTotal: Math.round(l.total * 100) / 100,
  }));
  const totalPrice =
    Math.round(lineData.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;

  // Extract and validate files
  const files = formData.getAll("invoices") as File[];
  const validFiles = files.filter((f) => f.size > 0);

  for (const file of validFiles) {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return {
        success: false,
        error: t('errors.invalidFileType', { name: file.name }),
      };
    }
    if (file.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: t('errors.fileTooLarge', { name: file.name }),
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
      await uploadFile({ key, body: buffer, contentType: file.type });
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
        totalPrice,
        notes: notes || null,
        lines: { create: lineData },
        invoices: {
          create: invoiceRecords,
        },
      },
    });
  } catch (e) {
    // Cleanup orphan uploads on failure
    await Promise.allSettled(uploadedKeys.map(deleteFile));
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
  const t = await getTranslations();

  const batch = await prisma.purchaseBatch.findUnique({
    where: { id: batchId },
    include: { lines: true },
  });

  if (!batch || batch.officeId !== officeId) {
    return { success: false, error: t('errors.purchaseNotFound') };
  }

  if (batch.status === "DELIVERED") {
    return { success: false, error: t('errors.alreadyDelivered') };
  }

  // Aggregate per item in case an order lists the same item on several lines.
  const qtyByItem = new Map<string, number>();
  for (const line of batch.lines) {
    qtyByItem.set(line.itemId, (qtyByItem.get(line.itemId) ?? 0) + line.qty);
  }

  await prisma.$transaction([
    prisma.purchaseBatch.update({
      where: { id: batchId },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    }),
    ...[...qtyByItem.entries()].flatMap(([itemId, qty]) =>
      stockDeltaOps({
        officeId,
        itemId,
        delta: qty,
        reason: "PURCHASE",
        note: `Delivery received: ${qty} units`,
        userId: membership.userId,
      }),
    ),
  ]);

  // Stock increased — reset low stock alerts if applicable
  for (const itemId of qtyByItem.keys()) {
    checkAndAlertLowStock(officeId, itemId).catch(() => {});
  }

  revalidatePath(`/org/${officeId}/admin/purchases`);
  revalidatePath(`/org/${officeId}/admin/stock`);
  return { success: true };
}

export async function getInvoiceUrl(
  officeId: string,
  invoiceFileId: string
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const invoice = await prisma.invoiceFile.findUnique({
    where: { id: invoiceFileId },
    include: {
      purchaseBatch: { select: { officeId: true } },
    },
  });

  if (!invoice || invoice.purchaseBatch.officeId !== officeId) {
    return { success: false, error: t('errors.invoiceNotFound') };
  }

  const url = internalFileUrl(invoice.storageKey);
  return { success: true, url };
}
