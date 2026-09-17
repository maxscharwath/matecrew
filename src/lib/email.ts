import { Resend, type CreateEmailOptions } from "resend";
import {
  passwordResetTemplate,
  emailVerificationTemplate,
  joinRequestTemplate,
  settlementTemplate,
  paymentReminderTemplate,
} from "@/lib/email-templates";
import { getTranslator } from "@/lib/slack";

let client: Resend | null = null;
function getResend() {
  client ??= new Resend(process.env.RESEND_API_KEY);
  return client;
}

const from = process.env.EMAIL_FROM ?? "MateCrew <matecrew@mail.stmx.ch>";

/**
 * Sends, and fails loudly when it did not.
 *
 * Resend answers a rejected or undelivered send with `{ error }` instead of
 * throwing, so an unwrapped call reports success for a mail that never left.
 * That was costing us the truth about the monthly statements: the delivery
 * ledger recorded people the provider had refused.
 */
async function send(payload: CreateEmailOptions): Promise<void> {
  const { error } = await getResend().emails.send(payload);
  if (error) {
    throw new Error(`Resend refused the mail: ${error.name} — ${error.message}`);
  }
}

/**
 * Every transactional mail is written in the recipient's language. The locale
 * is the caller's to resolve — Better Auth hands these callbacks its own user
 * object, which is not where MateCrew keeps the preference.
 */
export async function sendEmailVerificationEmail(
  to: string,
  verifyUrl: string,
  locale: string,
) {
  const t = await getTranslator(locale);
  await send({
    from,
    to,
    subject: t("email.verification.subject"),
    html: emailVerificationTemplate({
      title: t("email.verification.title"),
      intro: t("email.verification.intro"),
      body: t("email.verification.body"),
      buttonLabel: t("email.verification.button"),
      buttonUrl: verifyUrl,
      copyLinkLabel: t("email.copyLink"),
      footer: t("email.footer"),
    }),
  });
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  locale: string,
) {
  const t = await getTranslator(locale);
  await send({
    from,
    to,
    subject: t("email.passwordReset.subject"),
    html: passwordResetTemplate({
      title: t("email.passwordReset.title"),
      intro: t("email.passwordReset.intro"),
      expiry: t("email.passwordReset.expiry"),
      buttonLabel: t("email.passwordReset.button"),
      buttonUrl: resetUrl,
      copyLinkLabel: t("email.copyLink"),
      footer: t("email.footer"),
    }),
  });
}

export async function sendJoinRequestEmail(opts: {
  to: string;
  locale: string;
  requesterName: string;
  requesterEmail: string;
  officeName: string;
  reviewUrl: string;
}) {
  const t = await getTranslator(opts.locale);
  await send({
    from,
    to: opts.to,
    subject: t("email.joinRequest.subject", { office: opts.officeName }),
    html: joinRequestTemplate({
      title: t("email.joinRequest.title"),
      intro: t("email.joinRequest.intro", { office: opts.officeName }),
      requesterLabel: t("email.joinRequest.requesterLabel"),
      requesterName: opts.requesterName,
      requesterEmail: opts.requesterEmail,
      officeLabel: t("email.joinRequest.officeLabel"),
      officeName: opts.officeName,
      buttonLabel: t("email.joinRequest.button"),
      buttonUrl: opts.reviewUrl,
      copyLinkLabel: t("email.copyLink"),
      footer: t("email.footer"),
    }),
  });
}

/**
 * One member's monthly statement, with the PDF attached.
 *
 * Localised to the recipient's own language rather than the office's: the
 * statement is addressed to a person, and this is the one mail they are
 * guaranteed to get every month.
 */
export async function sendSettlementEmail(opts: {
  to: string;
  locale: string;
  officeName: string;
  /** Human period label, e.g. "juillet 2026". */
  periodLabel: string;
  qty: number;
  costShare: string;
  /** Their average price per can, already formatted. */
  avgUnitPrice: string;
  /** Their share of the missing cans, or null when there was no shrinkage. */
  lossShare: string | null;
  /** Signed: positive = owes, negative = is owed. */
  netOwed: number;
  amountValue: string;
  /** Who to pay, or who owes them — the actionable part of the statement. */
  payments: {
    direction: "pay" | "receive";
    otherUserName: string;
    amount: string;
  }[];
  reimbursementsUrl: string;
  pdf: Buffer;
  pdfFilename: string;
}) {
  const t = await getTranslator(opts.locale);
  const direction =
    opts.netOwed > 0.005 ? "pay" : opts.netOwed < -0.005 ? "receive" : "settled";

  await send({
    from,
    to: opts.to,
    subject: t("email.settlement.subject", {
      period: opts.periodLabel,
      office: opts.officeName,
    }),
    html: settlementTemplate({
      title: t("email.settlement.title", { period: opts.periodLabel }),
      intro: t("email.settlement.intro", {
        office: opts.officeName,
        period: opts.periodLabel,
      }),
      amountLabel: t(`email.settlement.amountLabel_${direction}`),
      amountValue: opts.amountValue,
      direction,
      rows: [
        { label: t("email.settlement.cansLabel"), value: String(opts.qty) },
        { label: t("email.settlement.priceLabel"), value: opts.avgUnitPrice },
        { label: t("email.settlement.shareLabel"), value: opts.costShare },
        // Shrinkage is billed to the period's drinkers, and people ask about
        // it, so it gets its own line rather than hiding inside the share.
        ...(opts.lossShare
          ? [{ label: t("email.settlement.lossLabel"), value: opts.lossShare }]
          : []),
      ],
      paymentsTitle: opts.payments.length > 0
        ? t("email.settlement.paymentsTitle")
        : null,
      payments: opts.payments.map((p) => ({
        label:
          p.direction === "pay"
            ? t("email.settlement.payTo", { name: p.otherUserName })
            : t("email.settlement.receiveFrom", { name: p.otherUserName }),
        value: p.amount,
        direction: p.direction,
      })),
      attachmentNote: t("email.settlement.attachmentNote"),
      buttonLabel: t("email.settlement.button"),
      buttonUrl: opts.reimbursementsUrl,
      copyLinkLabel: t("email.copyLink"),
      footer: t("email.settlement.footer", { office: opts.officeName }),
    }),
    attachments: [{ filename: opts.pdfFilename, content: opts.pdf }],
  });
}

/**
 * One reminder for everything a member still owes an office.
 *
 * Deliberately not one mail per unpaid period: three mails landing together
 * read as a system malfunctioning, while one mail listing three months reads
 * as a bill. Every listed period rides along as its own PDF, so the detail is
 * there without the mail having to reproduce it.
 */
export async function sendPaymentReminderEmail(opts: {
  to: string;
  locale: string;
  officeName: string;
  /** How many periods are still open — drives the singular/plural wording. */
  periodCount: number;
  attachmentCount: number;
  /** Formatted totals, one per currency. */
  totals: string[];
  periods: {
    label: string;
    amount: string;
    /** Matés they drank that month, or null when the figure is unknown. */
    qty: number | null;
    /** Their share of the period's missing cans, or null when there was none. */
    lossShare: string | null;
    creditors: { name: string; amount: string }[];
  }[];
  reimbursementsUrl: string;
  attachments: { filename: string; content: Buffer }[];
}) {
  const t = await getTranslator(opts.locale);
  await send({
    from,
    to: opts.to,
    subject: t("email.reminder.subject", { office: opts.officeName }),
    html: paymentReminderTemplate({
      title: t("email.reminder.title"),
      intro: t("email.reminder.intro", {
        office: opts.officeName,
        count: opts.periodCount,
      }),
      amountLabel: t("email.reminder.amountLabel"),
      amountValues: opts.totals,
      periodsTitle: t("email.reminder.periodsTitle"),
      periods: opts.periods.map((p) => ({
        label: p.label,
        amount: p.amount,
        // What the amount is *for*: the cans, and the shrinkage inside it.
        detail:
          [
            p.qty === null
              ? null
              : t("email.reminder.cansLabel", { count: p.qty }),
            p.lossShare
              ? t("email.reminder.lossLabel", { amount: p.lossShare })
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        // Who to actually send the money to — the question a reminder exists
        // to answer, and the one a bare creditor name left implicit.
        payTo: p.creditors.map(
          (c) => `${t("email.reminder.payTo", { name: c.name })} · ${c.amount}`,
        ),
      })),
      attachmentNote: t("email.reminder.attachmentNote", {
        count: opts.attachmentCount,
      }),
      buttonLabel: t("email.reminder.button"),
      buttonUrl: opts.reimbursementsUrl,
      copyLinkLabel: t("email.copyLink"),
      footer: t("email.reminder.footer", { office: opts.officeName }),
    }),
    attachments: opts.attachments,
  });
}
