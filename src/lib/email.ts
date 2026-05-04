import { Resend } from "resend";
import { passwordResetTemplate, emailVerificationTemplate } from "@/lib/email-templates";

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
