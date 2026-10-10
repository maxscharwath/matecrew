"use server";

import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { sendSessionNotifications } from "@/lib/notifications";
import { closeMonthlyReimbursements } from "@/lib/monthly-reimbursement";
import { pruneExpiredOauthTokens } from "@/lib/mcp/token-cleanup";
import type { ScheduleName } from "@/jobs/schedules";

type TriggerResult =
  | { success: true; message: string }
  | { success: false; error: string };

/** Runs a scheduled task now, limited to this office where the task is per office. */
export async function triggerCron(
  officeId: string,
  cronId: ScheduleName,
): Promise<TriggerResult> {
  await requireOrgRoles(officeId, "ADMIN");

  switch (cronId) {
    case "session-notifications":
      return triggerSessionNotifications(officeId);
    case "monthly-reimbursement":
      return triggerMonthlyReimbursement(officeId);
    case "oauth-token-prune":
      return triggerTokenPrune();
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
    select: { slackChannelId: true },
  });

  if (!office?.slackChannelId) {
    return { success: false, error: t('errors.noSlackChannelConfigured') };
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
  const { closed, offices } = await closeMonthlyReimbursements({ now: new Date(), officeId });
  const { month, year } = closed;
  const outcome = offices.get(officeId);

  switch (outcome?.status) {
    case "created":
      return outcome.statementsQueued
        ? { success: true, message: t('errors.periodCreated', { month, year, lines: outcome.lines }) }
        : { success: false, error: t('errors.statementsNotQueued', { month, year }) };
    case "exists":
      return { success: false, error: t('errors.periodAlreadyExists', { month, year }) };
    case "failed":
      return { success: false, error: outcome.error };
    default:
      return { success: false, error: t('errors.noConsumptionForPeriod', { month, year }) };
  }
}

async function triggerTokenPrune(): Promise<TriggerResult> {
  const t = await getTranslations();
  const { deleted } = await pruneExpiredOauthTokens();
  return { success: true, message: t('errors.oauthTokensPruned', { count: deleted }) };
}
