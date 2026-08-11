"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import {
  backfillReimbursementPeriods,
  syncReimbursementPeriod,
} from "@/lib/reimbursement-periods";
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

  const result = await backfillReimbursementPeriods(officeId);
  if (result.kind === "no_activity") {
    return { success: false, error: t('errors.noActivityData') };
  }

  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/reimbursements`);
  return { success: true, created: result.created };
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
    itemPrices: result.itemPrices,
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
    avgUnitPrice: result.avgUnitPrice,
    itemPrices: result.itemPrices,
    shares: result.shares,
    lines: result.lines,
    locale: period.office.locale,
  });

  await uploadFile({ key, body: pdfBuffer, contentType: "application/pdf" });
  const url = internalFileUrl(key);
  return { success: true, url };
}

export async function syncPeriod(
  officeId: string,
  periodId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const result = await syncReimbursementPeriod(officeId, periodId);
  if (result.kind === "not_found") {
    return { success: false, error: t("errors.periodNotFound") };
  }

  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/reimbursements`);
  return { success: true };
}
