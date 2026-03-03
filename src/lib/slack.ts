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
  webhookUrl: string,
  blocks: SlackBlock[],
  text: string,
) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, blocks }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status}`);
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
