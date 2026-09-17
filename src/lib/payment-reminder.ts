import "server-only";

import { prisma } from "@/lib/prisma";
import { getBaseUrl } from "@/lib/base-url";
import { sendPaymentReminderEmail } from "@/lib/email";
import { buildUserSettlement } from "@/lib/settlement-pdf";
import { formatMonthLabel } from "@/lib/date";
import { formatMoney } from "@/lib/money";

/**
 * The nudge an admin sends when a bill has been sitting unpaid.
 *
 * The monthly statement mail is per *period*: it goes out once when the month
 * closes and says nothing afterwards. What an admin actually chases is a
 * *person* — someone who owes for March, April and May. So a reminder is one
 * mail per debtor carrying every period they still owe for, each with its own
 * statement PDF attached, rather than three separate mails they have to
 * reassemble themselves.
 *
 * Nothing is recorded: unlike the statement send, re-sending a reminder is the
 * point, so there is no delivery ledger to skip against. The confirmation in
 * front of "remind everybody" is what stops an accidental double nudge.
 */

/** One unpaid period inside a person's reminder. */
export interface DebtorPeriod {
  periodId: string;
  year: number;
  month: number;
  startDate: Date;
  /** Still owed for this period, pending lines only. */
  amount: number;
  currency: string;
  /** Who the money goes to — the same names the statement PDF lists. */
  creditors: { name: string; amount: number }[];
}

/** A member with money outstanding somewhere in the office's history. */
export interface Debtor {
  userId: string;
  name: string;
  email: string | null;
  image: string | null;
  locale: string;
  /** Owed across every open period. Split by currency so CHF never meets EUR. */
  totals: { currency: string; amount: number }[];
  /** Oldest first: the period that has been waiting longest leads the mail. */
  periods: DebtorPeriod[];
}

/** Resend allows a couple of requests a second; offices are small, so wait. */
const SEND_INTERVAL_MS = 600;

/** Decimal sums leave rounding dust; a "CHF 0.00" debt is not a debt. */
const EPSILON = 0.01;

/**
 * Everybody who still owes the office money, with the periods they owe it for.
 *
 * Only current members are returned. A person who left keeps their lines in
 * the period — the numbers must still add up — but the reminder links into a
 * page they can no longer open, so mailing them would be a dead end.
 */
export async function getOfficeDebtors(officeId: string): Promise<Debtor[]> {
  const [lines, memberships] = await Promise.all([
    prisma.reimbursementLine.findMany({
      where: { status: "PENDING", period: { officeId } },
      select: {
        amount: true,
        currency: true,
        fromUser: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            locale: true,
          },
        },
        toUser: { select: { name: true } },
        period: {
          select: { id: true, year: true, month: true, startDate: true },
        },
      },
    }),
    prisma.membership.findMany({
      where: { officeId },
      select: { userId: true },
    }),
  ]);

  const members = new Set(memberships.map((m) => m.userId));
  const byUser = new Map<string, Debtor>();
  // Keyed by `${userId}:${periodId}:${currency}` — a period frozen under two
  // currencies is two rows, the same way the debt banner treats it.
  const byPeriod = new Map<string, DebtorPeriod>();

  for (const line of lines) {
    const user = line.fromUser;
    if (!members.has(user.id)) continue;

    const amount = line.amount.toNumber();
    let debtor = byUser.get(user.id);
    if (!debtor) {
      debtor = {
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        locale: user.locale,
        totals: [],
        periods: [],
      };
      byUser.set(user.id, debtor);
    }

    const total = debtor.totals.find((t) => t.currency === line.currency);
    if (total) total.amount += amount;
    else debtor.totals.push({ currency: line.currency, amount });

    const key = `${user.id}:${line.period.id}:${line.currency}`;
    let period = byPeriod.get(key);
    if (!period) {
      period = {
        periodId: line.period.id,
        year: line.period.year,
        month: line.period.month,
        startDate: line.period.startDate,
        amount: 0,
        currency: line.currency,
        creditors: [],
      };
      byPeriod.set(key, period);
      debtor.periods.push(period);
    }
    period.amount += amount;

    const creditor = period.creditors.find((c) => c.name === line.toUser.name);
    if (creditor) creditor.amount += amount;
    else period.creditors.push({ name: line.toUser.name, amount });
  }

  return [...byUser.values()]
    .map((debtor) => ({
      ...debtor,
      totals: debtor.totals.filter((t) => t.amount > EPSILON),
      periods: debtor.periods
        .filter((p) => p.amount > EPSILON)
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime()),
    }))
    .filter((debtor) => debtor.periods.length > 0)
    .sort((a, b) => sumAmounts(b.totals) - sumAmounts(a.totals));
}

/** Only for ordering the list — never shown, so mixing currencies is safe. */
function sumAmounts(totals: { amount: number }[]): number {
  return totals.reduce((sum, t) => sum + t.amount, 0);
}

export interface RemindersResult {
  sent: number;
  /** No address on file, or no statement could be built for them. */
  skipped: number;
  failed: { name: string; error: string }[];
}

/**
 * Mails a reminder to the given debtors, or to every debtor when `userIds` is
 * omitted.
 *
 * One mail per person, every unpaid period inside it, one PDF attached per
 * period. A recipient whose mail throws is reported rather than aborting the
 * run: the people already reached should not be re-mailed by a retry of the
 * whole office.
 */
export async function sendPaymentReminders(
  officeId: string,
  opts: { userIds?: string[] } = {},
): Promise<RemindersResult> {
  const [office, allDebtors] = await Promise.all([
    prisma.office.findUnique({
      where: { id: officeId },
      select: { name: true },
    }),
    getOfficeDebtors(officeId),
  ]);
  if (!office) return { sent: 0, skipped: 0, failed: [] };

  const wanted = opts.userIds ? new Set(opts.userIds) : null;
  const debtors = wanted
    ? allDebtors.filter((d) => wanted.has(d.userId))
    : allDebtors;

  const url = `${getBaseUrl()}/org/${officeId}/reimbursements`;
  let sent = 0;
  let skipped = 0;
  const failed: { name: string; error: string }[] = [];

  for (const [index, debtor] of debtors.entries()) {
    if (!debtor.email) {
      skipped++;
      continue;
    }
    try {
      const { locale } = debtor;

      // The PDF is the one they can already download for that period, built
      // through the same path so a reminder can never attach a document that
      // disagrees with the button on their settlements page.
      const attachments: { filename: string; content: Buffer }[] = [];
      // Keyed by period, so the mail can name the coulage inside each amount
      // and say how many matés the amount is for.
      const lossByPeriod = new Map<string, number>();
      const qtyByPeriod = new Map<string, number>();
      for (const period of debtor.periods) {
        const statement = await buildUserSettlement({
          periodId: period.periodId,
          userId: debtor.userId,
          wantBytes: true,
        });
        if (!statement?.buffer) continue;
        attachments.push({
          filename: `matecrew-${period.year}-${String(period.month).padStart(2, "0")}.pdf`,
          content: statement.buffer,
        });
        // Only when the period is still owed in full. Part-paid, the pending
        // amount is no longer the whole bill, and "incl. X of shrinkage" would
        // be describing a figure that is not on the line above it.
        const stillWholeBill =
          Math.abs(statement.netOwed - period.amount) < 0.011;
        if (statement.lossShare >= 0.005 && stillWholeBill) {
          lossByPeriod.set(period.periodId, statement.lossShare);
        }
        // Cans are not money: the count is true whatever has been paid off,
        // so unlike the coulage it needs no reconciliation guard.
        if (statement.qty > 0) qtyByPeriod.set(period.periodId, statement.qty);
      }
      if (attachments.length === 0) {
        skipped++;
        continue;
      }

      await sendPaymentReminderEmail({
        to: debtor.email,
        locale,
        officeName: office.name,
        periodCount: debtor.periods.length,
        attachmentCount: attachments.length,
        // One line per currency, so a mixed-currency debt reads as two
        // amounts rather than one meaningless sum.
        totals: debtor.totals.map((t) =>
          formatMoney(t.amount, locale, t.currency),
        ),
        periods: debtor.periods.map((p) => {
          const loss = lossByPeriod.get(p.periodId);
          return {
            label: formatMonthLabel(p.startDate, locale),
            amount: formatMoney(p.amount, locale, p.currency),
            // Shrinkage is billed to the period's drinkers and people ask
            // about it, so the reminder names it rather than letting the
            // total quietly carry it.
            lossShare:
              loss === undefined
                ? null
                : formatMoney(loss, locale, p.currency),
            qty: qtyByPeriod.get(p.periodId) ?? null,
            creditors: p.creditors.map((c) => ({
              name: c.name,
              amount: formatMoney(c.amount, locale, p.currency),
            })),
          };
        }),
        reimbursementsUrl: url,
        attachments,
      });
      sent++;
    } catch (e) {
      failed.push({
        name: debtor.name,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }

    if (index < debtors.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS));
    }
  }

  return { sent, skipped, failed };
}
