import { prisma } from "@/lib/prisma";
import { sendSlackMessage, buildLowStockMessage } from "@/lib/slack";

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Checks a single item's stock pool and sends a low-stock Slack alert when it
 * dips to/below the office threshold (with a 24h cooldown per item). Resets the
 * alert flag once stock recovers.
 */
export async function checkAndAlertLowStock(
  officeId: string,
  itemId: string,
): Promise<void> {
  const stock = await prisma.stock.findUnique({
    where: { officeId_itemId: { officeId, itemId } },
    include: { office: true, item: { select: { name: true } } },
  });

  if (!stock) return;

  const { office } = stock;
  if (!office.slackChannelId) return;

  if (stock.currentQty <= office.lowStockThreshold) {
    // Check cooldown — don't spam
    if (
      stock.lowStockAlertSentAt &&
      Date.now() - stock.lowStockAlertSentAt.getTime() < ALERT_COOLDOWN_MS
    ) {
      return;
    }

    const { blocks, fallback } = await buildLowStockMessage(
      office.name,
      stock.currentQty,
      office.lowStockThreshold,
      office.locale,
      stock.item.name,
    );

    await sendSlackMessage(office.slackChannelId, blocks, fallback);

    await prisma.stock.update({
      where: { officeId_itemId: { officeId, itemId } },
      data: { lowStockAlertSentAt: new Date() },
    });
  } else if (stock.lowStockAlertSentAt) {
    // Stock recovered — reset alert so it fires again next time
    await prisma.stock.update({
      where: { officeId_itemId: { officeId, itemId } },
      data: { lowStockAlertSentAt: null },
    });
  }
}
