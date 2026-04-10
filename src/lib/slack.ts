import { createTranslator } from "next-intl";

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{
    type: string;
    text?: { type: string; text: string };
    url?: string;
  }>;
}

async function getTranslator(locale: string) {
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages });
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

export async function buildDailyRequestMessage(
  officeId: string,
  officeName: string,
  date: string,
  appUrl: string,
  locale: string,
) {
  const t = await getTranslator(locale);
  const requestUrl = `${appUrl}/request?office=${officeId}&date=${date}`;

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("slack.mateOfTheDay", { office: officeName, date }),
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: t("slack.iWantMate") },
            url: requestUrl,
          },
        ],
      },
    ],
    fallback: t("slack.newMessage"),
  };
}

export async function buildSessionRequestMessage(
  officeId: string,
  officeName: string,
  sessionLabel: string | null,
  cutoffTime: string,
  appUrl: string,
  locale: string,
) {
  const t = await getTranslator(locale);
  const requestUrl = `${appUrl}/org/${officeId}/request`;
  const label = sessionLabel ? ` — ${sessionLabel}` : "";

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: t("slack.sessionRequest", { label, office: officeName, cutoff: cutoffTime }),
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: t("slack.iWantMate") },
            url: requestUrl,
          },
        ],
      },
    ],
    fallback: t("slack.newMessage"),
  };
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
