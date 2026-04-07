// Email-safe colors derived from the app's CSS design tokens
const colors = {
  background: "#ffffff",
  foreground: "#171717",
  card: "#ffffff",
  cardBorder: "#e5e5e5",
  primary: "#1a1a1a",
  primaryForeground: "#fafafa",
  muted: "#f5f5f5",
  mutedForeground: "#737373",
  border: "#e5e5e5",
};

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MateCrew</title>
</head>
<body style="margin:0;padding:0;background-color:${colors.muted};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${colors.foreground};-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:${colors.muted};padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Logo / Header -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;margin-bottom:24px;">
          <tr>
            <td align="center" style="padding-bottom:8px;">
              <span style="font-size:22px;font-weight:700;letter-spacing:-0.5px;color:${colors.foreground};">MateCrew</span>
            </td>
          </tr>
        </table>

        <!-- Card -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;background-color:${colors.card};border:1px solid ${colors.cardBorder};border-radius:10px;overflow:hidden;">
          <tr>
            <td style="padding:40px 40px 32px;">
              ${content}
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;margin-top:24px;">
          <tr>
            <td align="center">
              <p style="margin:0;font-size:12px;color:${colors.mutedForeground};line-height:1.6;">
                You received this email from <strong>MateCrew</strong>.<br/>
                If you did not request this, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

function button(label: string, href: string): string {
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:28px 0 0;">
    <tr>
      <td>
        <a href="${href}" target="_blank" style="display:inline-block;background-color:${colors.primary};color:${colors.primaryForeground};font-size:14px;font-weight:600;text-decoration:none;padding:11px 24px;border-radius:8px;letter-spacing:0.01em;">${label}</a>
      </td>
    </tr>
  </table>
  <p style="margin:16px 0 0;font-size:12px;color:${colors.mutedForeground};">
    Or copy this link: <a href="${href}" style="color:${colors.foreground};word-break:break-all;">${href}</a>
  </p>`;
}

function divider(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
    <tr><td style="border-top:1px solid ${colors.border};"></td></tr>
  </table>`;
}

export function passwordResetTemplate(resetUrl: string): string {
  return layout(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;letter-spacing:-0.3px;color:${colors.foreground};">Reset your password</h1>
    <p style="margin:0;font-size:14px;color:${colors.mutedForeground};line-height:1.6;">
      We received a request to reset the password for your MateCrew account.
      Click the button below to choose a new password.
    </p>
    ${divider()}
    <p style="margin:0;font-size:14px;color:${colors.foreground};line-height:1.6;">
      This link will expire in <strong>1 hour</strong>. If you did not request a password reset, no action is needed.
    </p>
    ${button("Reset my password", resetUrl)}
  `);
}

export function emailVerificationTemplate(verifyUrl: string): string {
  return layout(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;letter-spacing:-0.3px;color:${colors.foreground};">Verify your email</h1>
    <p style="margin:0;font-size:14px;color:${colors.mutedForeground};line-height:1.6;">
      Thanks for signing up for MateCrew! Please verify your email address to secure your account.
    </p>
    ${divider()}
    <p style="margin:0;font-size:14px;color:${colors.foreground};line-height:1.6;">
      Click the button below to confirm your email address.
    </p>
    ${button("Verify my email", verifyUrl)}
  `);
}
