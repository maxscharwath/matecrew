import { prisma } from "@/lib/prisma";
import { sendSlackMessage } from "@/lib/slack";

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function checkAndAlertLowStock(
  officeId: string
): Promise<void> {
  const stock = await prisma.stock.findUnique({
    where: { officeId },
    include: { office: true },
  });

  if (!stock) return;

  const { office } = stock;
  if (!office.slackWebhookUrl) return;

  if (stock.currentQty <= office.lowStockThreshold) {
    // Check cooldown — don't spam
    if (
      stock.lowStockAlertSentAt &&
      Date.now() - stock.lowStockAlertSentAt.getTime() < ALERT_COOLDOWN_MS
    ) {
      return;
    }

    await sendSlackMessage(
      office.slackWebhookUrl,
      [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:warning: *Stock bas — ${office.name}*\n${stock.currentQty} canettes restantes (seuil: ${office.lowStockThreshold})`,
          },
        },
      ],
      `Stock bas: ${stock.currentQty} canettes (${office.name})`
    );

    await prisma.stock.update({
      where: { officeId },
      data: { lowStockAlertSentAt: new Date() },
    });
  } else if (stock.lowStockAlertSentAt) {
    // Stock recovered — reset alert so it fires again next time
    await prisma.stock.update({
      where: { officeId },
      data: { lowStockAlertSentAt: null },
    });
  }
}
