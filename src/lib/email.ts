import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const from = process.env.EMAIL_FROM ?? "MateCrew <noreply@mail.stmx.ch>";

export async function sendEmailVerificationEmail(to: string, verifyUrl: string) {
  await resend.emails.send({
    from,
    to,
    subject: "Verify your MateCrew email",
    html: `
      <p>Please verify your email address to complete your MateCrew account setup.</p>
      <p><a href="${verifyUrl}">Verify my email</a></p>
      <p>If you did not create an account, you can safely ignore this email.</p>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await resend.emails.send({
    from,
    to,
    subject: "Reset your MateCrew password",
    html: `
      <p>You requested a password reset for your MateCrew account.</p>
      <p>Click the link below to set a new password. This link expires in 1 hour.</p>
      <p><a href="${resetUrl}">Reset my password</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
    `,
  });
}
