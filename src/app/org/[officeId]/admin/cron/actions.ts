"use server";

import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { sendSessionNotifications } from "@/lib/notifications";
import { calculateReimbursements } from "@/lib/reimbursement-calc";

type TriggerResult =
  | { success: true; message: string }
  | { success: false; error: string };

export async function triggerCron(
  officeId: string,
  cronId: string,
): Promise<TriggerResult> {
  await requireOrgRoles(officeId, "ADMIN");

  switch (cronId) {
    case "daily-request":
      return triggerSessionNotifications(officeId);
    case "monthly-reimbursement":
      return triggerMonthlyReimbursement(officeId);
    default: {
      const t = await getTranslations();
      return { success: false, error: t('errors.cronUnknown') };
    }
  }
}

async function triggerSessionNotifications(officeId: string): Promise<TriggerResult> {
  const t = await getTranslations();

  const office = await prisma.office.findUnique({
    where: { id: officeId },
    select: { slackWebhookUrl: true },
  });

  if (!office?.slackWebhookUrl) {
    return { success: false, error: t('errors.noSlackWebhookConfigured') };
  }

  const results = await sendSessionNotifications({
    officeId,
    skipTimeWindow: true,
  });

  if (results.length === 0) {
    return {
      success: false,
      error: t('errors.noSessionsToNotify'),
    };
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    return {
      success: false,
      error: t('errors.notificationErrors', { count: failed.length, errors: failed.map((f) => f.error).join(", ") }),
    };
  }

  return {
    success: true,
    message: t('errors.notificationsSent', { count: results.length, sessions: results.map((r) => r.session).join(", ") }),
  };
}

async function triggerMonthlyReimbursement(officeId: string): Promise<TriggerResult> {
  const t = await getTranslations();

  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = prevMonth.getMonth() + 1;
  const year = prevMonth.getFullYear();
  const startDate = prevMonth;
  const endDate = new Date(year, month, 0);

  const existing = await prisma.reimbursementPeriod.findUnique({
    where: {
      officeId_year_month: { officeId, year, month },
    },
  });

  if (existing) {
    return {
      success: false,
      error: t('errors.periodAlreadyExists', { month, year }),
    };
  }

  const result = await calculateReimbursements(officeId, startDate, endDate);

  if (result.totalConsumption === 0 && result.totalCost === 0) {
    return {
      success: false,
      error: t('errors.noConsumptionForPeriod', { month, year }),
    };
  }

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

  return {
    success: true,
    message: t('errors.periodCreated', { month, year, lines: result.lines.length }),
  };
}
