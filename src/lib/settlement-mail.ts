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
 * Sending is one-shot per *recipient*, not per run: every delivery is recorded,
 * and a run skips the people already on record. That is what makes the send
 * safe to retry — a request that dies halfway (a timeout, a mail provider
 * having a bad day) neither re-mails the people it reached nor abandons the
 * ones it never got to, which a single per-period flag could not express.
 * `force` is the deliberate override behind an admin confirmation: it mails
 * everybody again.
 */

export type StatementsResult =
  | { kind: "already_sent"; at: Date }
  | { kind: "no_recipients" }
  | {
      kind: "sent";
      sent: number;
      /** Already on record from an earlier run, or with no usable address. */
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
  const [members, delivered] = await Promise.all([
    prisma.membership.findMany({
      where: { officeId: period.officeId, userId: { in: [...concerned] } },
      select: {
        user: { select: { id: true, name: true, email: true, locale: true } },
      },
    }),
    prisma.statementDelivery.findMany({
      where: { periodId },
      select: { userId: true },
    }),
  ]);

  const alreadyMailed = new Set(delivered.map((d) => d.userId));
  // Nothing left to do, and the period was already marked: say so rather than
  // reporting a run that mailed nobody — that is what the admin UI turns into
  // "already sent, re-send?".
  if (
    !opts.force &&
    period.statementsSentAt &&
    members.every(({ user }) => alreadyMailed.has(user.id))
  ) {
    return { kind: "already_sent", at: period.statementsSentAt };
  }

  const pending = opts.force
    ? members
    : members.filter(({ user }) => !alreadyMailed.has(user.id));
  if (pending.length === 0) {
    return { kind: "sent", sent: 0, skipped: members.length, failed: [] };
  }

  const url = `${getBaseUrl()}/org/${period.officeId}/reimbursements`;
  let sent = 0;
  let skipped = 0;
  const failed: { name: string; error: string }[] = [];

  for (const [index, { user }] of pending.entries()) {
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
        avgUnitPrice: money(statement.avgUnitPrice, user.locale),
        lossShare:
          statement.lossShare >= 0.005
            ? money(statement.lossShare, user.locale)
            : null,
        netOwed: statement.netOwed,
        payments: statement.lines.map((l) => ({
          direction: l.direction,
          otherUserName: l.otherUserName,
          amount: money(l.amount, user.locale),
        })),
        // The headline is what they do about it, so it is always the absolute
        // amount — the direction is carried by the label and the colour.
        amountValue: money(Math.abs(statement.netOwed), user.locale),
        reimbursementsUrl: url,
        pdf: statement.buffer,
        pdfFilename: `matecrew-${period.year}-${String(period.month).padStart(2, "0")}.pdf`,
      });
      // Recorded only after the send returned: a row here means a mail left,
      // and a later run reads it to know not to send again.
      await prisma.statementDelivery.upsert({
        where: { periodId_userId: { periodId, userId: user.id } },
        create: { periodId, userId: user.id, email: user.email },
        update: { email: user.email, sentAt: new Date() },
      });
      sent++;
    } catch (e) {
      failed.push({
        name: user.name,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }

    if (index < pending.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS));
    }
  }

  // Stamped only when something actually went out, so a period whose mails all
  // failed can be retried without `force`. The per-recipient rows are the
  // real bookkeeping; this is the date the UI shows.
  if (sent > 0) {
    await prisma.reimbursementPeriod.update({
      where: { id: periodId },
      data: { statementsSentAt: new Date() },
    });
  }

  return {
    kind: "sent",
    sent,
    skipped: skipped + (members.length - pending.length),
    failed,
  };
}
