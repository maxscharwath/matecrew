import crypto from "node:crypto";
import { createTranslator } from "next-intl";

interface SlackSelectOption {
  text: { type: "plain_text"; text: string };
  description?: { type: "plain_text"; text: string };
  value: string;
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  accessory?: { type: "image"; image_url: string; alt_text: string };
  elements?: Array<{
    type: string;
    text?: { type: string; text: string } | string;
    url?: string;
    action_id?: string;
    value?: string;
    style?: string;
    placeholder?: { type: "plain_text"; text: string };
    options?: SlackSelectOption[];
    initial_option?: SlackSelectOption;
    image_url?: string;
    alt_text?: string;
  }>;
}

export async function getTranslator(locale: string) {
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages });
}

export const SLACK_REQUEST_ACTION_ID = "request_mate";
export const SLACK_CANCEL_ACTION_ID = "cancel_mate";
export const SLACK_MARK_SERVED_ACTION_ID = "mark_session_served";
export const SLACK_MANAGE_ACTION_ID = "manage_order";
export const SLACK_PICK_ACTION_ID = "pick_item";

/**
 * Slack only renders images from absolute https URLs, so relative
 * `/api/files/...` paths are resolved against the public app URL. Returns
 * undefined in non-https environments (local dev) where Slack couldn't
 * fetch the image anyway.
 */
export function publicImageUrl(relativeUrl: string | undefined): string | undefined {
  if (!relativeUrl) return undefined;
  if (relativeUrl.startsWith("https://")) return relativeUrl;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl?.startsWith("https://")) return undefined;
  return `${appUrl}${relativeUrl}`;
}

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
 * Posts a message visible only to `user` in `channel` ("Only visible to you").
 * Unlike a `response_url` ephemeral, this can never replace the original
 * channel message, and unlike a direct interaction HTTP response it is
 * reliably rendered for block_actions.
 */
export async function postEphemeralMessage(opts: {
  channel: string;
  user: string;
  blocks: SlackBlock[];
  text: string;
}): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not configured");

  const response = await fetch("https://slack.com/api/chat.postEphemeral", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: opts.channel,
      user: opts.user,
      text: opts.text,
      blocks: opts.blocks,
    }),
  });
  if (!response.ok) {
    throw new Error(`Slack chat.postEphemeral request failed: ${response.status}`);
  }
  const data = (await response.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack chat.postEphemeral error: ${data.error}`);
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
  itemImageUrl?: string;
  names: string[];
  members?: { name: string; avatarUrl?: string }[];
}

// A context block accepts at most 10 elements; item thumb + label + names
// leave room for this many avatars.
const MAX_AVATARS_PER_GROUP = 7;

/**
 * One context row per item: item thumbnail, "*Item* ×N", the requesters'
 * avatars, and their names. Context images render as small inline icons,
 * which is exactly the right size for avatars.
 */
function requesterGroupBlocks(
  t: Awaited<ReturnType<typeof getTranslator>>,
  groups: ItemRequesterGroupInput[],
): SlackBlock[] {
  if (groups.length === 0) {
    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: t("slack.noRequestsYet") },
      },
    ];
  }
  return groups.map((g) => {
    const members = g.members ?? g.names.map((name) => ({ name, avatarUrl: undefined }));
    const elements: NonNullable<SlackBlock["elements"]> = [];
    const itemImg = publicImageUrl(g.itemImageUrl);
    if (itemImg) {
      elements.push({ type: "image", image_url: itemImg, alt_text: g.itemName });
    }
    elements.push({
      type: "mrkdwn",
      text: t("slack.requesterGroupItem", { item: g.itemName, count: members.length }),
    });
    for (const m of members.slice(0, MAX_AVATARS_PER_GROUP)) {
      const avatar = publicImageUrl(m.avatarUrl);
      if (avatar) {
        elements.push({ type: "image", image_url: avatar, alt_text: m.name });
      }
    }
    elements.push({ type: "mrkdwn", text: members.map((m) => m.name).join(", ") });
    return { type: "context", elements: elements.slice(0, 10) };
  });
}

export interface SlackItemInput {
  id: string;
  name: string;
  stockQty?: number;
  imageUrl?: string;
}

/** Items worth offering in Slack: out-of-stock ones are hidden entirely. */
export function inStockItems<T extends SlackItemInput>(items: T[]): T[] {
  return items.filter((i) => i.stockQty === undefined || i.stockQty > 0);
}

/** One select option per item, with the stock count as its description. */
function itemSelectOptions(
  t: Awaited<ReturnType<typeof getTranslator>>,
  items: SlackItemInput[],
  ctx: { officeId: string; mateSessionId: string | null; date: string },
): SlackSelectOption[] {
  return items.map((item) => ({
    text: { type: "plain_text" as const, text: item.name.slice(0, 75) },
    ...(item.stockQty !== undefined
      ? {
          description: {
            type: "plain_text" as const,
            text: t("slack.stockCount", { count: item.stockQty }),
          },
        }
      : {}),
    value: encodeActionValue({
      officeId: ctx.officeId,
      mateSessionId: ctx.mateSessionId,
      date: ctx.date,
      itemId: item.id,
    }),
  }));
}

export async function buildSessionRequestMessage(opts: {
  officeId: string;
  officeName: string;
  mateSessionId: string | null;
  sessionLabel: string | null;
  cutoffTime: string;
  date: string;
  locale: string;
  items: SlackItemInput[];
  requesterGroups?: ItemRequesterGroupInput[];
}) {
  const t = await getTranslator(opts.locale);
  const label = opts.sessionLabel ? ` — ${opts.sessionLabel}` : "";
  const items = inStockItems(opts.items);

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
    blocks.push(...requesterGroupBlocks(t, opts.requesterGroups));
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const openUrl = `${appUrl}/org/${opts.officeId}/request`;

  const ctx = {
    officeId: opts.officeId,
    mateSessionId: opts.mateSessionId,
    date: opts.date,
  };

  // A single in-stock item keeps the familiar one-click button; several items
  // offer a dropdown so the row stays compact however many items exist.
  const elements: NonNullable<SlackBlock["elements"]> = [];
  if (items.length === 1) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: t("slack.iWantMate") },
      action_id: `${SLACK_REQUEST_ACTION_ID}:${items[0].id}`,
      value: encodeActionValue({ ...ctx, itemId: items[0].id }),
      style: "primary" as const,
    });
  } else if (items.length > 1) {
    elements.push({
      type: "static_select",
      action_id: SLACK_PICK_ACTION_ID,
      placeholder: { type: "plain_text", text: t("slack.pickItem") },
      options: itemSelectOptions(t, items, ctx),
    });
  }
  elements.push(
    {
      type: "button",
      text: { type: "plain_text", text: t("slack.manageOrder") },
      action_id: SLACK_MANAGE_ACTION_ID,
      value: encodeActionValue(ctx),
    },
    {
      type: "button",
      text: { type: "plain_text", text: t("slack.openInApp") },
      url: openUrl,
    },
  );
  blocks.push({ type: "actions", elements });

  return { blocks, fallback: t("slack.newMessage") };
}

/**
 * Private ("Only visible to you") order-management view: shows the user's
 * current order with the item's image, a select of in-stock items to order or
 * switch, and a cancel button. Sent via chat.postEphemeral on "manage" clicks
 * and refreshed in place via response_url after each action.
 */
export async function buildOrderManageMessage(opts: {
  officeId: string;
  mateSessionId: string | null;
  date: string;
  locale: string;
  items: SlackItemInput[];
  current: { itemId: string; itemName: string; imageUrl?: string } | null;
}) {
  const t = await getTranslator(opts.locale);
  const items = inStockItems(opts.items);

  const currentStock = opts.current
    ? items.find((i) => i.id === opts.current!.itemId)?.stockQty
    : undefined;
  const headerText = opts.current
    ? [
        t("slack.yourOrder", { item: opts.current.itemName }),
        ...(currentStock !== undefined
          ? [t("slack.stockCount", { count: currentStock })]
          : []),
      ].join("\n")
    : t("slack.noOrderYet");
  const imageUrl = publicImageUrl(opts.current?.imageUrl);
  // Slack renders section accessory images as a fixed-size (~88px) thumbnail;
  // the two-line text keeps the block visually balanced next to it.
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: headerText },
      ...(imageUrl && opts.current
        ? {
            accessory: {
              type: "image" as const,
              image_url: imageUrl,
              alt_text: opts.current.itemName,
            },
          }
        : {}),
    },
  ];

  const options = itemSelectOptions(t, items, {
    officeId: opts.officeId,
    mateSessionId: opts.mateSessionId,
    date: opts.date,
  });
  const currentOption = options.find(
    (o) => decodeActionValue(o.value)?.itemId === opts.current?.itemId,
  );

  const elements: NonNullable<SlackBlock["elements"]> = [];
  if (options.length > 0) {
    elements.push({
      type: "static_select",
      action_id: SLACK_PICK_ACTION_ID,
      placeholder: { type: "plain_text", text: t("slack.pickItem") },
      options,
      ...(currentOption ? { initial_option: currentOption } : {}),
    });
  }
  if (opts.current) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: t("slack.cancelOrder") },
      action_id: SLACK_CANCEL_ACTION_ID,
      value: encodeActionValue({
        officeId: opts.officeId,
        mateSessionId: opts.mateSessionId,
        date: opts.date,
      }),
      style: "danger",
    });
  }
  if (elements.length > 0) {
    blocks.push({ type: "actions", elements });
  }

  return { blocks, fallback: headerText };
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

  // Per-item context rows already carry the ×N counts, so no separate
  // "2× Classic, 1× Ginger" summary line is needed.
  if (opts.requesterGroups.length > 0) {
    blocks.push(...requesterGroupBlocks(t, opts.requesterGroups));
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
