import crypto from "node:crypto";
import { createTranslator } from "next-intl";

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{
    type: string;
    text?: { type: string; text: string };
    url?: string;
    action_id?: string;
    value?: string;
    style?: string;
  }>;
}

export async function getTranslator(locale: string) {
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages });
}

export const SLACK_REQUEST_ACTION_ID = "request_mate";
export const SLACK_CANCEL_ACTION_ID = "cancel_mate";

/**
 * Encodes the (office, session, date) context into the button's `value`.
 * Slack returns this verbatim on click so the handler can rebuild the message.
 */
export function encodeActionValue(opts: {
  officeId: string;
  mateSessionId: string | null;
  date: string;
}): string {
  return `${opts.officeId}|${opts.mateSessionId ?? ""}|${opts.date}`;
}

export function decodeActionValue(
  value: string,
): { officeId: string; mateSessionId: string | null; date: string } | null {
  const parts = value.split("|");
  if (parts.length !== 3) return null;
  const [officeId, mateSessionId, date] = parts;
  if (!officeId || !date) return null;
  return { officeId, mateSessionId: mateSessionId || null, date };
}

/**
 * Verifies a Slack-signed request per https://api.slack.com/authentication/verifying-requests-from-slack
 * Rejects requests older than 5 minutes (replay protection).
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) throw new Error("SLACK_SIGNING_SECRET is not configured");
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const computed = `v0=${crypto.createHmac("sha256", secret).update(base).digest("hex")}`;
  if (signature.length !== computed.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
  } catch {
    return false;
  }
}

/**
 * Looks up a Slack user's email via the Web API. Requires `users:read.email` scope.
 */
export async function fetchSlackUserEmail(slackUserId: string): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not configured");

  const res = await fetch(
    `https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    ok: boolean;
    user?: { profile?: { email?: string } };
  };
  if (!data.ok) return null;
  return data.user?.profile?.email ?? null;
}

export async function sendSlackMessage(
  channelId: string,
  blocks: SlackBlock[],
  text: string,
) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is not configured");
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: channelId,
      text,
      blocks,
      ...(process.env.SLACK_BOT_USERNAME && { username: process.env.SLACK_BOT_USERNAME }),
      ...(process.env.SLACK_BOT_ICON_URL && { icon_url: process.env.SLACK_BOT_ICON_URL }),
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack API request failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
}

/**
 * Posts a response to a Slack interaction `response_url`.
 * Used to update the original message (or send an ephemeral follow-up) after ack.
 */
export async function postToResponseUrl(
  responseUrl: string,
  payload: {
    blocks?: SlackBlock[];
    text?: string;
    response_type?: "ephemeral" | "in_channel";
    replace_original?: boolean;
  },
) {
  const res = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Slack response_url POST failed: ${res.status}`);
  }
}

export async function buildSessionRequestMessage(opts: {
  officeId: string;
  officeName: string;
  mateSessionId: string | null;
  sessionLabel: string | null;
  cutoffTime: string;
  date: string;
  locale: string;
  requesters?: string[];
}) {
  const t = await getTranslator(opts.locale);
  const label = opts.sessionLabel ? ` — ${opts.sessionLabel}` : "";
  const actionValue = encodeActionValue({
    officeId: opts.officeId,
    mateSessionId: opts.mateSessionId,
    date: opts.date,
  });

  let requestersText: string | null = null;
  if (opts.requesters !== undefined) {
    requestersText =
      opts.requesters.length === 0
        ? t("slack.noRequestsYet")
        : t("slack.requestersList", { names: opts.requesters.join(", ") });
  }

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("slack.sessionRequest", {
          label,
          office: opts.officeName,
          cutoff: opts.cutoffTime,
        }),
      },
    },
  ];

  if (requestersText !== null) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: requestersText },
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const openUrl = `${appUrl}/org/${opts.officeId}/request`;

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: t("slack.iWantMate") },
        action_id: SLACK_REQUEST_ACTION_ID,
        value: actionValue,
        style: "primary",
      },
      {
        type: "button",
        text: { type: "plain_text", text: t("slack.cancelMate") },
        action_id: SLACK_CANCEL_ACTION_ID,
        value: actionValue,
      },
      {
        type: "button",
        text: { type: "plain_text", text: t("slack.openInApp") },
        url: openUrl,
      },
    ],
  });

  return { blocks, fallback: t("slack.newMessage") };
}

export async function buildLowStockMessage(
  officeName: string,
  currentQty: number,
  threshold: number,
  locale: string,
) {
  const t = await getTranslator(locale);

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("slack.lowStock", { office: officeName, qty: currentQty, threshold }),
        },
      },
    ],
    fallback: t("slack.lowStockFallback", { qty: currentQty, office: officeName }),
  };
}

export async function buildMonthlyBillMessage(opts: {
  officeName: string;
  month: number;
  year: number;
  totalConsumption: number;
  totalCost: number;
  consumers: number;
  appUrl: string;
  officeId: string;
  locale: string;
}) {
  const { officeName, month, year, totalConsumption, totalCost, consumers, appUrl, officeId, locale } = opts;
  const t = await getTranslator(locale);
  const reimbursementsUrl = `${appUrl}/org/${officeId}/reimbursements`;

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("slack.monthlyBill", {
            office: officeName,
            month,
            year,
            consumers,
            totalQty: totalConsumption,
            totalCost: totalCost.toFixed(2),
          }),
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: t("slack.viewReimbursements") },
            url: reimbursementsUrl,
          },
        ],
      },
    ],
    fallback: t("slack.monthlyBillFallback", { office: officeName, month, year }),
  };
}

export async function buildConnectSlackMessage(opts: {
  connectUrl: string;
  locale: string;
}) {
  const t = await getTranslator(opts.locale);
  return {
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: t("slack.connectPrompt") },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: t("slack.connectButton") },
            url: opts.connectUrl,
            style: "primary",
          },
        ],
      },
    ],
  };
}

const ERROR_KEYS = {
  closed: "slack.errorClosed",
  session_not_found: "slack.errorSessionNotFound",
  served: "slack.errorServed",
  unknown: "slack.errorUnknown",
} as const;

export async function buildConnectErrorMessage(opts: {
  locale: string;
  reason: keyof typeof ERROR_KEYS;
}) {
  const t = await getTranslator(opts.locale);
  const key = ERROR_KEYS[opts.reason];
  return {
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: t(key) } },
    ],
  };
}

export async function buildTestMessage(
  officeName: string,
  locale: string,
) {
  const t = await getTranslator(locale);

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("slack.testMessage", { office: officeName }),
        },
      },
    ],
    fallback: t("slack.testFallback", { office: officeName }),
  };
}
