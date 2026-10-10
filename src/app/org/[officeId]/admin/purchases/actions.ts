"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BatchConflictError, commitBatch, expectRows, prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { buildInvoiceKey, internalFileUrl } from "@/lib/storage";
import { platform } from "@/platform";
import { checkAndAlertLowStock } from "@/lib/stock-alerts";
import { stockDeltaOps } from "@/lib/stock";
import { toCents } from "@/lib/money";
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
    unitPriceCents: toCents(l.total / l.qty),
    lineTotalCents: toCents(l.total),
  }));
  const totalPriceCents = lineData.reduce((sum, l) => sum + l.lineTotalCents, 0);

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
      await platform.storage.put(key, buffer, { contentType: file.type });
      uploadedKeys.push(key);
      invoiceRecords.push({
        storageKey: key,
        filename: file.name,
        mimeType: file.type,
      });
    }

    // Create purchase as ORDERED — stock is added when marked as delivered.
    // One atomic batch: the order, its lines and its invoices land together
    // or not at all (the id is ours, so the lines can point at it).
    await commitBatch((db) => [
      db.purchaseBatch.createMany({
        data: [
          {
            id: batchId,
            officeId,
            status: "ORDERED",
            purchasedAt,
            orderedByUserId: membership.userId,
            paidByUserId,
            totalPriceCents,
            notes: notes || null,
          },
        ],
      }),
      db.purchaseLine.createMany({ data: lineData.map((l) => ({ ...l, batchId })) }),
      ...(invoiceRecords.length > 0
        ? [db.invoiceFile.createMany({ data: invoiceRecords.map((r) => ({ ...r, purchaseBatchId: batchId })) })]
        : []),
    ]);
  } catch (e) {
    // Cleanup orphan uploads on failure
    await Promise.allSettled(uploadedKeys.map((key) => platform.storage.delete(key)));
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

  // Read above, one atomic batch here. Guard: the order flips to DELIVERED
  // only if it is still ORDERED, so two clicks racing cannot add its cans to
  // stock twice — the second batch is rolled back whole.
  const now = new Date();
  try {
    await commitBatch((db) => [
      expectRows(
        db.purchaseBatch.updateMany({
          where: { id: batchId, status: "ORDERED" },
          data: { status: "DELIVERED", deliveredAt: now },
        }),
        1,
      ),
      ...[...qtyByItem.entries()].flatMap(([itemId, qty]) =>
        stockDeltaOps(
          db,
          {
            officeId,
            itemId,
            delta: qty,
            reason: "PURCHASE",
            note: `Delivery received: ${qty} units`,
            userId: membership.userId,
          },
          now,
        ),
      ),
    ]);
  } catch (error) {
    if (error instanceof BatchConflictError) {
      return { success: false, error: t('errors.alreadyDelivered') };
    }
    throw error;
  }

  // Stock increased — reset low stock alerts if applicable
  for (const itemId of qtyByItem.keys()) {
    platform.runInBackground(checkAndAlertLowStock(officeId, itemId), "low-stock alert");
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
