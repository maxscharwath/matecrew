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
  buildUserSettlementKey,
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

export async function syncPeriod(
  officeId: string,
  periodId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
    include: {
      lines: true,
    },
  });

  if (!period || period.officeId !== officeId) {
    return { success: false, error: t("errors.periodNotFound") };
  }

  // Recalculate what the period should look like now
  const result = await calculateReimbursements(
    officeId,
    period.startDate,
    period.endDate
  );

  // Separate existing lines by status
  const paidLines = period.lines.filter((l) => l.status === "PAID");
  const pendingLineIds = period.lines
    .filter((l) => l.status === "PENDING")
    .map((l) => l.id);

  // Build residual balances: start from the fresh calculation,
  // then subtract what PAID lines already cover.
  // netOwed > 0 means user owes money (debtor), < 0 means user is owed (creditor)
  const balanceMap = new Map<string, number>();
  for (const share of result.shares) {
    balanceMap.set(share.userId, share.netOwed);
  }

  for (const paid of paidLines) {
    // fromUser paid toUser → reduce fromUser's debt, reduce toUser's credit
    const fromBal = balanceMap.get(paid.fromUserId) ?? 0;
    balanceMap.set(paid.fromUserId, fromBal - paid.amount.toNumber());

    const toBal = balanceMap.get(paid.toUserId) ?? 0;
    balanceMap.set(paid.toUserId, toBal + paid.amount.toNumber());
  }

  // Generate new payment lines from residual balances
  const debtors: { userId: string; remaining: number }[] = [];
  const creditors: { userId: string; remaining: number }[] = [];

  for (const [userId, balance] of balanceMap) {
    const rounded = Math.round(balance * 100) / 100;
    if (rounded > 0.01) {
      debtors.push({ userId, remaining: rounded });
    } else if (rounded < -0.01) {
      creditors.push({ userId, remaining: -rounded });
    }
  }

  debtors.sort((a, b) => b.remaining - a.remaining);
  creditors.sort((a, b) => b.remaining - a.remaining);

  const newLines: { fromUserId: string; toUserId: string; amount: number }[] = [];
  let di = 0;
  let ci = 0;

  while (di < debtors.length && ci < creditors.length) {
    const amount = Math.min(debtors[di].remaining, creditors[ci].remaining);
    if (amount > 0.01) {
      newLines.push({
        fromUserId: debtors[di].userId,
        toUserId: creditors[ci].userId,
        amount: Math.round(amount * 100) / 100,
      });
    }
    debtors[di].remaining -= amount;
    creditors[ci].remaining -= amount;
    if (debtors[di].remaining < 0.01) di++;
    if (creditors[ci].remaining < 0.01) ci++;
  }

  // Transaction: delete old PENDING lines, create new ones
  await prisma.$transaction([
    prisma.reimbursementLine.deleteMany({
      where: { id: { in: pendingLineIds } },
    }),
    ...newLines.map((l) =>
      prisma.reimbursementLine.create({
        data: {
          periodId,
          fromUserId: l.fromUserId,
          toUserId: l.toUserId,
          amount: l.amount,
          currency: "CHF",
        },
      })
    ),
  ]);

  // Purge cached PDFs (they are now stale)
  const allUserIds = new Set([
    ...result.shares.map((s) => s.userId),
    ...paidLines.flatMap((l) => [l.fromUserId, l.toUserId]),
  ]);
  const pdfDeletes = [
    deleteFile(buildSettlementKey(periodId)),
    ...[...allUserIds].map((uid) =>
      deleteFile(buildUserSettlementKey(periodId, uid))
    ),
  ];
  await Promise.allSettled(pdfDeletes);

  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/reimbursements`);
  return { success: true };
}
