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

interface LayoutChrome {
  /** Footer line under the card. Defaults to the English wording. */
  footer?: string;
}

function layout(content: string, chrome: LayoutChrome = {}): string {
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
                ${chrome.footer ?? `You received this email from <strong>MateCrew</strong>.<br/>If you did not request this, you can safely ignore it.`}
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

function button(label: string, href: string, copyLabel = "Or copy this link:"): string {
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:28px 0 0;">
    <tr>
      <td>
        <a href="${href}" target="_blank" style="display:inline-block;background-color:${colors.primary};color:${colors.primaryForeground};font-size:14px;font-weight:600;text-decoration:none;padding:11px 24px;border-radius:8px;letter-spacing:0.01em;">${label}</a>
      </td>
    </tr>
  </table>
  <p style="margin:16px 0 0;font-size:12px;color:${colors.mutedForeground};">
    ${copyLabel} <a href="${href}" style="color:${colors.foreground};word-break:break-all;">${href}</a>
  </p>`;
}

function divider(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
    <tr><td style="border-top:1px solid ${colors.border};"></td></tr>
  </table>`;
}

export function passwordResetTemplate(opts: {
  title: string;
  intro: string;
  expiry: string;
  buttonLabel: string;
  buttonUrl: string;
  copyLinkLabel: string;
  footer: string;
}): string {
  return layout(
    `
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;letter-spacing:-0.3px;color:${colors.foreground};">${opts.title}</h1>
    <p style="margin:0;font-size:14px;color:${colors.mutedForeground};line-height:1.6;">${opts.intro}</p>
    ${divider()}
    <p style="margin:0;font-size:14px;color:${colors.foreground};line-height:1.6;">${opts.expiry}</p>
    ${button(opts.buttonLabel, opts.buttonUrl, opts.copyLinkLabel)}
  `,
    { footer: opts.footer },
  );
}

export function joinRequestTemplate(opts: {
  title: string;
  intro: string;
  requesterLabel: string;
  requesterName: string;
  requesterEmail: string;
  officeLabel: string;
  officeName: string;
  buttonLabel: string;
  buttonUrl: string;
  copyLinkLabel: string;
  footer: string;
}): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:${colors.mutedForeground};width:120px;">${label}</td>
      <td style="padding:6px 0;font-size:14px;color:${colors.foreground};">${value}</td>
    </tr>`;
  return layout(
    `
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;letter-spacing:-0.3px;color:${colors.foreground};">${opts.title}</h1>
    <p style="margin:0;font-size:14px;color:${colors.mutedForeground};line-height:1.6;">${opts.intro}</p>
    ${divider()}
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
      ${row(opts.requesterLabel, `${opts.requesterName} &lt;${opts.requesterEmail}&gt;`)}
      ${row(opts.officeLabel, opts.officeName)}
    </table>
    ${button(opts.buttonLabel, opts.buttonUrl, opts.copyLinkLabel)}
  `,
    { footer: opts.footer },
  );
}

/**
 * The monthly statement mail: what you drank, what it comes to, and who to
 * settle with. The PDF rides along as an attachment; the button goes to the
 * reimbursements page where the payment can be marked.
 *
 * The amount is the headline because it is the only line most people read —
 * and it is coloured by direction, so "you owe" and "you are owed" cannot be
 * confused at a glance.
 */
export function settlementTemplate(opts: {
  title: string;
  intro: string;
  amountLabel: string;
  amountValue: string;
  /** Which way the money goes — decides the accent colour. */
  direction: "pay" | "receive" | "settled";
  rows: { label: string; value: string }[];
  /** Null hides the block — a settled month has nobody to pay. */
  paymentsTitle: string | null;
  payments: { label: string; value: string; direction: "pay" | "receive" }[];
  attachmentNote: string;
  buttonLabel: string;
  buttonUrl: string;
  /** Localised chrome — this mail goes out monthly, in the reader's language. */
  copyLinkLabel: string;
  footer: string;
}): string {
  const accent =
    opts.direction === "pay"
      ? "#dc2626"
      : opts.direction === "receive"
        ? "#16a34a"
        : colors.foreground;
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:${colors.mutedForeground};">${label}</td>
      <td style="padding:6px 0;font-size:14px;color:${colors.foreground};text-align:right;">${value}</td>
    </tr>`;
  return layout(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;letter-spacing:-0.3px;color:${colors.foreground};">${opts.title}</h1>
    <p style="margin:0;font-size:14px;color:${colors.mutedForeground};line-height:1.6;">${opts.intro}</p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0 0;background-color:${colors.muted};border-radius:8px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px;font-size:12px;color:${colors.mutedForeground};text-transform:uppercase;letter-spacing:0.04em;">${opts.amountLabel}</p>
          <p style="margin:0;font-size:26px;font-weight:700;color:${accent};">${opts.amountValue}</p>
        </td>
      </tr>
    </table>
    ${divider()}
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      ${opts.rows.map((r) => row(r.label, r.value)).join("")}
    </table>
    ${
      opts.paymentsTitle && opts.payments.length > 0
        ? `${divider()}
    <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${colors.foreground};">${opts.paymentsTitle}</p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      ${opts.payments
        .map(
          (p) => `
      <tr>
        <td style="padding:6px 0;font-size:13px;color:${colors.mutedForeground};">${p.label}</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:${p.direction === "pay" ? "#dc2626" : "#16a34a"};text-align:right;">${p.value}</td>
      </tr>`,
        )
        .join("")}
    </table>`
        : ""
    }
    <p style="margin:20px 0 0;font-size:13px;color:${colors.mutedForeground};line-height:1.6;">${opts.attachmentNote}</p>
    ${button(opts.buttonLabel, opts.buttonUrl, opts.copyLinkLabel)}
  `, { footer: opts.footer });
}

export function emailVerificationTemplate(opts: {
  title: string;
  intro: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  copyLinkLabel: string;
  footer: string;
}): string {
  return layout(
    `
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;letter-spacing:-0.3px;color:${colors.foreground};">${opts.title}</h1>
    <p style="margin:0;font-size:14px;color:${colors.mutedForeground};line-height:1.6;">${opts.intro}</p>
    ${divider()}
    <p style="margin:0;font-size:14px;color:${colors.foreground};line-height:1.6;">${opts.body}</p>
    ${button(opts.buttonLabel, opts.buttonUrl, opts.copyLinkLabel)}
  `,
    { footer: opts.footer },
  );
}
