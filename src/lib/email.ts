import { Resend } from "resend";
import {
  passwordResetTemplate,
  emailVerificationTemplate,
  joinRequestTemplate,
  settlementTemplate,
} from "@/lib/email-templates";
import { getTranslator } from "@/lib/slack";

let client: Resend | null = null;
function getResend() {
  client ??= new Resend(process.env.RESEND_API_KEY);
  return client;
}

const from = process.env.EMAIL_FROM ?? "MateCrew <matecrew@mail.stmx.ch>";

export async function sendEmailVerificationEmail(to: string, verifyUrl: string) {
  await getResend().emails.send({
    from,
    to,
    subject: "Verify your MateCrew email",
    html: emailVerificationTemplate(verifyUrl),
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await getResend().emails.send({
    from,
    to,
    subject: "Reset your MateCrew password",
    html: passwordResetTemplate(resetUrl),
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
  await getResend().emails.send({
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
  /** Signed: positive = owes, negative = is owed. */
  netOwed: number;
  amountValue: string;
  reimbursementsUrl: string;
  pdf: Buffer;
  pdfFilename: string;
}) {
  const t = await getTranslator(opts.locale);
  const direction =
    opts.netOwed > 0.005 ? "pay" : opts.netOwed < -0.005 ? "receive" : "settled";

  await getResend().emails.send({
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
        { label: t("email.settlement.shareLabel"), value: opts.costShare },
      ],
      attachmentNote: t("email.settlement.attachmentNote"),
      buttonLabel: t("email.settlement.button"),
      buttonUrl: opts.reimbursementsUrl,
      copyLinkLabel: t("email.copyLink"),
      footer: t("email.settlement.footer", { office: opts.officeName }),
    }),
    attachments: [{ filename: opts.pdfFilename, content: opts.pdf }],
  });
}
