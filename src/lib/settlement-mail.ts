import "server-only";

import { prisma } from "@/lib/prisma";
import { getBaseUrl } from "@/lib/base-url";
import { sendSettlementEmail } from "@/lib/email";
import { calculateReimbursements } from "@/lib/reimbursement-calc";
import { buildUserSettlement } from "@/lib/settlement-pdf";

/**
 * Mails every member of an office their own statement for one period.
 *
 * The month's numbers only become real to people when they land in their
 * inbox; until then the settlement lives on a page nobody opens. So this runs
 * off the back of the monthly cron, and an admin can fire it by hand for a
 * period that predates the feature or after a correction.
 *
 * Sending is one-shot by design: `statementsSentAt` is checked before the
 * first mail and stamped after the last, because a cron that retries must not
 * mail the whole office a second copy of the same bill. `force` is the
 * deliberate override behind an admin confirmation.
 */

export type StatementsResult =
  | { kind: "already_sent"; at: Date }
  | { kind: "no_recipients" }
  | {
      kind: "sent";
      sent: number;
      /** Members with nothing to report, or no usable address. */
      skipped: number;
      failed: { name: string; error: string }[];
    };

/** Resend allows a couple of requests a second; offices are small, so wait. */
const SEND_INTERVAL_MS = 600;

function periodLabel(start: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(start);
}

function money(amount: number, locale: string, currency = "CHF"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export async function sendPeriodStatements(
  periodId: string,
  opts: { force?: boolean } = {},
): Promise<StatementsResult> {
  const period = await prisma.reimbursementPeriod.findUnique({
    where: { id: periodId },
    include: {
      office: { select: { id: true, name: true } },
      lines: { select: { fromUserId: true, toUserId: true } },
    },
  });
  if (!period) return { kind: "no_recipients" };
  if (period.statementsSentAt && !opts.force) {
    return { kind: "already_sent", at: period.statementsSentAt };
  }

  const result = await calculateReimbursements(
    period.officeId,
    period.startDate,
    period.endDate,
  );

  // Everyone the period actually concerns: they drank something, or they owe
  // or are owed by somebody. A member who was away all month gets no mail —
  // an invoice for nothing is noise, not transparency.
  const concerned = new Set<string>();
  for (const share of result.shares) {
    if (share.qty > 0 || Math.abs(share.netOwed) >= 0.005) {
      concerned.add(share.userId);
    }
  }
  for (const line of period.lines) {
    concerned.add(line.fromUserId);
    concerned.add(line.toUserId);
  }
  if (concerned.size === 0) return { kind: "no_recipients" };

  // Membership is what makes someone part of this office today: a person who
  // left keeps their history in the period but stops receiving its mail.
  const members = await prisma.membership.findMany({
    where: { officeId: period.officeId, userId: { in: [...concerned] } },
    select: {
      user: { select: { id: true, name: true, email: true, locale: true } },
    },
  });

  const url = `${getBaseUrl()}/org/${period.officeId}/reimbursements`;
  let sent = 0;
  let skipped = 0;
  const failed: { name: string; error: string }[] = [];

  for (const [index, { user }] of members.entries()) {
    if (!user.email) {
      skipped++;
      continue;
    }
    try {
      const statement = await buildUserSettlement({
        periodId,
        userId: user.id,
        wantBytes: true,
        result,
      });
      if (!statement?.buffer) {
        skipped++;
        continue;
      }

      const label = periodLabel(period.startDate, user.locale);
      await sendSettlementEmail({
        to: user.email,
        locale: user.locale,
        officeName: period.office.name,
        periodLabel: label,
        qty: statement.qty,
        costShare: money(statement.costShare, user.locale),
        netOwed: statement.netOwed,
        // The headline is what they do about it, so it is always the absolute
        // amount — the direction is carried by the label and the colour.
        amountValue: money(Math.abs(statement.netOwed), user.locale),
        reimbursementsUrl: url,
        pdf: statement.buffer,
        pdfFilename: `matecrew-${period.year}-${String(period.month).padStart(2, "0")}.pdf`,
      });
      sent++;
    } catch (e) {
      failed.push({
        name: user.name,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }

    if (index < members.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS));
    }
  }

  // Stamped only when something actually went out, so a period whose mails all
  // failed can be retried without `force`.
  if (sent > 0) {
    await prisma.reimbursementPeriod.update({
      where: { id: periodId },
      data: { statementsSentAt: new Date() },
    });
  }

  return { kind: "sent", sent, skipped, failed };
}
