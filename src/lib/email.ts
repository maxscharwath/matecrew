import { Resend } from "resend";
import {
  passwordResetTemplate,
  emailVerificationTemplate,
  joinRequestTemplate,
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
