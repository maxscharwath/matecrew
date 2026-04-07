import { Resend } from "resend";
import { passwordResetTemplate, emailVerificationTemplate } from "@/lib/email-templates";

const resend = new Resend(process.env.RESEND_API_KEY);

const from = process.env.EMAIL_FROM ?? "MateCrew <noreply@mail.stmx.ch>";

export async function sendEmailVerificationEmail(to: string, verifyUrl: string) {
  await resend.emails.send({
    from,
    to,
    subject: "Verify your MateCrew email",
    html: emailVerificationTemplate(verifyUrl),
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await resend.emails.send({
    from,
    to,
    subject: "Reset your MateCrew password",
    html: passwordResetTemplate(resetUrl),
  });
}
