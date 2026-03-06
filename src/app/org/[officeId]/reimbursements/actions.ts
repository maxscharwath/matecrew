"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireMembership, requireOrgRoles } from "@/lib/auth-utils";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { generateUserSettlementPdf } from "@/lib/pdf-export";
import {
  buildUserSettlementKey,
  fileExists,
  uploadFile,
  getSignedUrl,
} from "@/lib/storage";

type ActionResult = { success: true } | { success: false; error: string };

export async function markPaymentPaid(
  officeId: string,
  lineId: string
): Promise<ActionResult> {
  const { session, membership } = await requireMembership(officeId);
  const userId = session.user.id;
  const t = await getTranslations();

  const line = await prisma.reimbursementLine.findUnique({
    where: { id: lineId },
    include: { period: { select: { officeId: true } } },
  });

  if (!line || line.period.officeId !== officeId) {
    return { success: false, error: t('errors.paymentNotFound') };
  }

  // Must be the debtor, creditor, or admin
  const isAdmin = membership.roles.includes("ADMIN");
  const isInvolved = line.fromUserId === userId || line.toUserId === userId;

  if (!isAdmin && !isInvolved) {
    return { success: false, error: t('errors.notAuthorizedPayment') };
  }

  if (line.status === "PAID") {
    return { success: false, error: t('errors.paymentAlreadyPaid') };
  }

  await prisma.reimbursementLine.update({
    where: { id: lineId },
    data: { status: "PAID", paidAt: new Date() },
  });

  revalidatePath(`/org/${officeId}/reimbursements`);
  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/dashboard`);
  return { success: true };
}

export async function markPaymentUnpaid(
  officeId: string,
  lineId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const line = await prisma.reimbursementLine.findUnique({
    where: { id: lineId },
    include: { period: { select: { officeId: true } } },
  });

  if (!line || line.period.officeId !== officeId) {
    return { success: false, error: t('errors.paymentNotFound') };
  }

  if (line.status === "PENDING") {
    return { success: false, error: t('errors.paymentAlreadyPending') };
  }

  await prisma.reimbursementLine.update({
    where: { id: lineId },
    data: { status: "PENDING", paidAt: null },
  });

  revalidatePath(`/org/${officeId}/reimbursements`);
  revalidatePath(`/org/${officeId}/admin/reimbursements`);
  revalidatePath(`/org/${officeId}/dashboard`);
  return { success: true };
}

export async function exportUserPeriodPdf(
  officeId: string,
  periodId: string
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const { session } = await requireMembership(officeId);
  const userId = session.user.id;
  const userName = session.user.name;
  const t = await getTranslations();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { locale: true },
  });

  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
    include: {
      office: { select: { name: true } },
      lines: {
        where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
        include: {
          fromUser: { select: { name: true } },
          toUser: { select: { name: true } },
        },
      },
    },
  });

  if (!period || period.officeId !== officeId) {
    return { success: false, error: t('errors.periodNotFound') };
  }

  const key = buildUserSettlementKey(periodId, userId);

  // Serve cached PDF if available
  if (await fileExists(key)) {
    const url = await getSignedUrl(key);
    return { success: true, url };
  }

  // Calculate user's share
  const result = await calculateReimbursements(
    officeId,
    period.startDate,
    period.endDate
  );

  const userShare = result.shares.find((s) => s.userId === userId);

  const userLines = period.lines.map((l) => {
    if (l.fromUserId === userId) {
      return {
        direction: "pay" as const,
        otherUserName: l.toUser.name,
        amount: l.amount.toNumber(),
      };
    }
    return {
      direction: "receive" as const,
      otherUserName: l.fromUser.name,
      amount: l.amount.toNumber(),
    };
  });

  const pdfBuffer = await generateUserSettlementPdf({
    officeName: period.office.name,
    userName,
    startDate: period.startDate,
    endDate: period.endDate,
    unitPrice: result.unitPrice,
    qty: userShare?.qty ?? 0,
    costShare: userShare?.costShare ?? 0,
    amountPaid: userShare?.amountPaid ?? 0,
    netOwed: userShare?.netOwed ?? 0,
    lines: userLines,
    locale: user.locale,
  });

  await uploadFile({ key, body: pdfBuffer, contentType: "application/pdf" });
  const url = await getSignedUrl(key);
  return { success: true, url };
}
