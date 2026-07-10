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
export const SLACK_MARK_SERVED_ACTION_ID = "mark_session_served";

/**
 * Encodes the (office, session, date, item) context into the button's `value`.
 * Slack returns this verbatim on click so the handler can rebuild the message.
 * `itemId` is only meaningful for the per-item request buttons; cancel and
 * mark-served leave it empty.
 */
export function encodeActionValue(opts: {
  officeId: string;
  mateSessionId: string | null;
  date: string;
  itemId?: string | null;
}): string {
  return `${opts.officeId}|${opts.mateSessionId ?? ""}|${opts.date}|${opts.itemId ?? ""}`;
}

export function decodeActionValue(
  value: string,
): {
  officeId: string;
  mateSessionId: string | null;
  date: string;
  itemId: string | null;
} | null {
  const parts = value.split("|");
  // Accept 3 parts (legacy messages without an item) and 4 parts (with item).
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [officeId, mateSessionId, date, itemId] = parts;
  if (!officeId || !date) return null;
  return {
    officeId,
    mateSessionId: mateSessionId || null,
    date,
    itemId: itemId || null,
  };
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
): Promise<{ ts: string; channel: string }> {
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

  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    ts?: string;
    channel?: string;
  };
  if (!data.ok || !data.ts || !data.channel) {
    throw new Error(`Slack API error: ${data.error ?? "missing ts"}`);
  }
  return { ts: data.ts, channel: data.channel };
}

/**
 * Updates a previously posted Slack message in place via chat.update.
 * Used to refresh the live requester list when requests/cancels happen
 * (from either a Slack button or the web UI).
 */
export async function updateSlackMessage(opts: {
  channel: string;
  ts: string;
  blocks: SlackBlock[];
  text: string;
}): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is not configured");
  }

  const response = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: opts.channel,
      ts: opts.ts,
      text: opts.text,
      blocks: opts.blocks,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack chat.update request failed: ${response.status}`);
  }
  const data = (await response.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack chat.update error: ${data.error}`);
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

export interface ItemRequesterGroupInput {
  itemId: string;
  itemName: string;
  names: string[];
}

/**
 * Renders the per-item requester breakdown as mrkdwn, e.g.
 *   *Maté Classic* (2): Alice, Bob
 *   *Ginger* (1): Claire
 */
function requesterBreakdown(
  t: Awaited<ReturnType<typeof getTranslator>>,
  groups: ItemRequesterGroupInput[],
): string {
  if (groups.length === 0) return t("slack.noRequestsYet");
  return groups
    .map((g) =>
      t("slack.requestersListItem", {
        item: g.itemName,
        count: g.names.length,
        names: g.names.join(", "),
      }),
    )
    .join("\n");
}

export async function buildSessionRequestMessage(opts: {
  officeId: string;
  officeName: string;
  mateSessionId: string | null;
  sessionLabel: string | null;
  cutoffTime: string;
  date: string;
  locale: string;
  items: { id: string; name: string }[];
  requesterGroups?: ItemRequesterGroupInput[];
}) {
  const t = await getTranslator(opts.locale);
  const label = opts.sessionLabel ? ` — ${opts.sessionLabel}` : "";

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

  if (opts.requesterGroups !== undefined) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: requesterBreakdown(t, opts.requesterGroups),
      },
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const openUrl = `${appUrl}/org/${opts.officeId}/request`;

  // One "I want <item>" button per active item. A single item keeps the
  // familiar single-button layout; several items surface a button each.
  const singleItem = opts.items.length === 1;
  const itemButtons = opts.items.map((item) => ({
    type: "button",
    text: {
      type: "plain_text",
      text: singleItem
        ? t("slack.iWantMate")
        : t("slack.iWantItem", { item: item.name }),
    },
    action_id: SLACK_REQUEST_ACTION_ID,
    value: encodeActionValue({
      officeId: opts.officeId,
      mateSessionId: opts.mateSessionId,
      date: opts.date,
      itemId: item.id,
    }),
    style: "primary" as const,
  }));

  const cancelValue = encodeActionValue({
    officeId: opts.officeId,
    mateSessionId: opts.mateSessionId,
    date: opts.date,
  });

  blocks.push({
    type: "actions",
    elements: [
      ...itemButtons,
      {
        type: "button",
        text: { type: "plain_text", text: t("slack.cancelMate") },
        action_id: SLACK_CANCEL_ACTION_ID,
        value: cancelValue,
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

/**
 * Cutoff-time message: posted when order registration closes, pings the channel
 * to remind someone to fetch the requested matés and offers a one-click "mark
 * everyone as served" button.
 */
export async function buildSessionCutoffMessage(opts: {
  officeId: string;
  officeName: string;
  mateSessionId: string | null;
  sessionLabel: string | null;
  date: string;
  locale: string;
  requesterGroups: ItemRequesterGroupInput[];
  servedBy?: { name: string; time: string } | null;
}) {
  const t = await getTranslator(opts.locale);
  const label = opts.sessionLabel ? ` — ${opts.sessionLabel}` : "";
  const actionValue = encodeActionValue({
    officeId: opts.officeId,
    mateSessionId: opts.mateSessionId,
    date: opts.date,
  });

  const count = opts.requesterGroups.reduce((sum, g) => sum + g.names.length, 0);
  // "2× Maté Classic, 1× Ginger" — what the runner needs to fetch.
  const itemSummary = opts.requesterGroups
    .map((g) => t("slack.cutoffItemCount", { count: g.names.length, item: g.itemName }))
    .join(", ");

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("slack.cutoffAlert", {
          label,
          office: opts.officeName,
          count,
        }),
      },
    },
  ];

  if (opts.requesterGroups.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${itemSummary}\n${requesterBreakdown(t, opts.requesterGroups)}`,
      },
    });
  }

  if (opts.servedBy) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: t("slack.cutoffServedBy", {
          name: opts.servedBy.name,
          time: opts.servedBy.time,
        }),
      },
    });
  } else {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: t("slack.markAllServed") },
          action_id: SLACK_MARK_SERVED_ACTION_ID,
          value: actionValue,
          style: "primary",
        },
      ],
    });
  }

  return {
    blocks,
    fallback: t("slack.cutoffFallback", {
      office: opts.officeName,
      count,
    }),
  };
}

/**
 * DM to office admins announcing a new pending join request, with a link to
 * the admin members page where they can approve or reject.
 */
export async function buildJoinRequestMessage(opts: {
  locale: string;
  requesterName: string;
  requesterEmail: string;
  officeName: string;
  reviewUrl: string;
}) {
  const t = await getTranslator(opts.locale);
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("slack.joinRequest", {
            name: opts.requesterName,
            email: opts.requesterEmail,
            office: opts.officeName,
          }),
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: t("slack.joinRequestReview") },
            url: opts.reviewUrl,
            style: "primary",
          },
        ],
      },
    ],
    fallback: t("slack.joinRequestFallback", {
      name: opts.requesterName,
      office: opts.officeName,
    }),
  };
}

export async function buildLowStockMessage(
  officeName: string,
  currentQty: number,
  threshold: number,
  locale: string,
  itemName: string,
) {
  const t = await getTranslator(locale);

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("slack.lowStock", {
            office: officeName,
            item: itemName,
            qty: currentQty,
            threshold,
          }),
        },
      },
    ],
    fallback: t("slack.lowStockFallback", {
      qty: currentQty,
      office: officeName,
      item: itemName,
    }),
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
