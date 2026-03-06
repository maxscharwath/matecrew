"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { generateReimbursementCsv } from "@/lib/csv-export";
import { generateSettlementPdf } from "@/lib/pdf-export";
import {
  buildSettlementKey,
  fileExists,
  uploadFile,
  internalFileUrl,
  deleteFile,
} from "@/lib/storage";

type ActionResult = { success: true } | { success: false; error: string };

export async function generateMissingPeriods(
  officeId: string
): Promise<{ success: true; created: number } | { success: false; error: string }> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  // Find earliest activity date
  const [earliestConsumption, earliestPurchase] = await Promise.all([
    prisma.consumptionEntry.findFirst({
      where: { officeId },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
    prisma.purchaseBatch.findFirst({
      where: { officeId },
      orderBy: { purchasedAt: "asc" },
      select: { purchasedAt: true },
    }),
  ]);

  const dates = [earliestConsumption?.date, earliestPurchase?.purchasedAt].filter(
    (d): d is Date => d != null
  );

  if (dates.length === 0) {
    return { success: false, error: t('errors.noActivityData') };
  }

  const earliest = dates.sort((a, b) => a.getTime() - b.getTime())[0];

  // Get existing periods
  const existingPeriods = await prisma.reimbursementPeriod.findMany({
    where: { officeId },
    select: { month: true, year: true },
  });
  const existingSet = new Set(
    existingPeriods.map((p) => `${p.year}-${p.month}`)
  );

  // Generate months from earliest to last month
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  let created = 0;

  const cursor = new Date(Date.UTC(earliest.getFullYear(), earliest.getMonth(), 1));
  while (cursor <= lastMonth) {
    const month = cursor.getUTCMonth() + 1;
    const year = cursor.getUTCFullYear();
    const key = `${year}-${month}`;

    if (!existingSet.has(key)) {
      const startDate = new Date(Date.UTC(year, month - 1, 1));
      const endDate = new Date(Date.UTC(year, month, 0));

      const result = await calculateReimbursements(officeId, startDate, endDate);

      if (result.totalConsumption > 0 || result.totalCost > 0) {
        await prisma.reimbursementPeriod.create({
          data: {
            officeId,
            month,
            year,
            startDate,
            endDate,
            lines: {
              create: result.lines.map((l) => ({
                fromUserId: l.fromUserId,
                toUserId: l.toUserId,
                amount: l.amount,
                currency: "CHF",
              })),
            },
          },
        });
        created++;
      }
    }

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/reimbursements`);
  return { success: true, created };
}

export async function deletePeriod(
  officeId: string,
  periodId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
  });

  if (!period || period.officeId !== officeId) {
    return { success: false, error: t('errors.periodNotFound') };
  }

  await prisma.$transaction([
    prisma.reimbursementLine.deleteMany({ where: { periodId } }),
    prisma.reimbursementPeriod.delete({ where: { id: periodId } }),
  ]);

  // Purge cached settlement PDF if present
  deleteFile(buildSettlementKey(periodId)).catch(() => {});

  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/reimbursements`);
  return { success: true };
}

export async function exportPeriodCsv(
  officeId: string,
  periodId: string
): Promise<{ success: true; csv: string } | { success: false; error: string }> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
    include: { office: { select: { name: true } } },
  });

  if (!period || period.officeId !== officeId) {
    return { success: false, error: t('errors.periodNotFound') };
  }

  const result = await calculateReimbursements(
    officeId,
    period.startDate,
    period.endDate
  );

  const csv = generateReimbursementCsv({
    officeName: period.office.name,
    startDate: period.startDate,
    endDate: period.endDate,
    totalConsumption: result.totalConsumption,
    totalCost: result.totalCost,
    shares: result.shares,
    lines: result.lines,
  });

  return { success: true, csv };
}

export async function exportPeriodPdf(
  officeId: string,
  periodId: string
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
    include: { office: { select: { name: true, locale: true } } },
  });

  if (!period || period.officeId !== officeId) {
    return { success: false, error: t('errors.periodNotFound') };
  }

  const key = buildSettlementKey(periodId);

  // Serve cached PDF if available
  if (await fileExists(key)) {
    const url = internalFileUrl(key);
    return { success: true, url };
  }

  // Generate and cache
  const result = await calculateReimbursements(
    officeId,
    period.startDate,
    period.endDate
  );

  const pdfBuffer = await generateSettlementPdf({
    officeName: period.office.name,
    startDate: period.startDate,
    endDate: period.endDate,
    totalConsumption: result.totalConsumption,
    totalCost: result.totalCost,
    unitPrice: result.unitPrice,
    shares: result.shares,
    lines: result.lines,
    locale: period.office.locale,
  });

  await uploadFile({ key, body: pdfBuffer, contentType: "application/pdf" });
  const url = internalFileUrl(key);
  return { success: true, url };
}
