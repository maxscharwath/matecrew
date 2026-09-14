"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireMembership, requireOrgRoles } from "@/lib/auth-utils";
import { buildUserSettlement } from "@/lib/settlement-pdf";

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
  const t = await getTranslations();

  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
    select: { officeId: true },
  });
  if (!period || period.officeId !== officeId) {
    return { success: false, error: t('errors.periodNotFound') };
  }

  const statement = await buildUserSettlement({
    periodId,
    userId: session.user.id,
  });
  if (!statement) {
    return { success: false, error: t('errors.periodNotFound') };
  }

  return { success: true, url: statement.url };
}
