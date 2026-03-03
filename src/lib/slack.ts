interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{
    type: string;
    text?: { type: string; text: string };
    url?: string;
  }>;
}

export async function sendSlackMessage(
  webhookUrl: string,
  blocks: SlackBlock[],
  text?: string
) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text ?? "New message from MateCrew",
      blocks,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status}`);
  }
}

export function buildDailyRequestMessage(
  officeId: string,
  officeName: string,
  date: string,
  appUrl: string
) {
  const requestUrl = `${appUrl}/request?office=${officeId}&date=${date}`;

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `☕ *Maté du jour — ${officeName}*\n📅 ${date}\n\nQui veut un maté aujourd'hui ?`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Je veux un maté !" },
          url: requestUrl,
        },
      ],
    },
  ];
}
