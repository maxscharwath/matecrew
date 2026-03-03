import { prisma } from "@/lib/prisma";
import { sendSlackMessage, buildSessionRequestMessage } from "@/lib/slack";
import { getDayOfWeek, getCurrentTimeInTimezone, timeToMinutes, getTodayDate, SCHEDULE_STEP_MINUTES } from "@/lib/date";

export interface NotificationResult {
  office: string;
  session: string;
  ok: boolean;
  error?: string;
}

/**
 * Send Slack notifications for sessions whose startTime falls within the cron detection window.
 * Used by the QStash cron and skips sessions already notified today.
 *
 * @param officeFilter — optional officeId to limit to a single office (for admin trigger)
 * @param skipTimeWindow — if true, notify all un-notified sessions for today regardless of time (manual trigger)
 */
export async function sendSessionNotifications(options?: {
  officeId?: string;
  skipTimeWindow?: boolean;
}): Promise<NotificationResult[]> {
  const offices = await prisma.office.findMany({
    where: {
      slackWebhookUrl: { not: null },
      ...(options?.officeId ? { id: options.officeId } : {}),
    },
    select: { id: true, name: true, slackWebhookUrl: true, timezone: true, locale: true },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const today = getTodayDate();
  const results: NotificationResult[] = [];

  for (const office of offices) {
    const dayOfWeek = getDayOfWeek(office.timezone);
    const currentTime = getCurrentTimeInTimezone(office.timezone);
    const nowMinutes = timeToMinutes(currentTime);

    const sessions = await prisma.mateSession.findMany({
      where: { officeId: office.id, dayOfWeek },
      orderBy: { startTime: "asc" },
    });

    for (const session of sessions) {
      // Time window check (skipped for manual admin triggers)
      if (!options?.skipTimeWindow) {
        const sessionMinutes = timeToMinutes(session.startTime);
        const diff = nowMinutes - sessionMinutes;
        if (diff < 0 || diff >= SCHEDULE_STEP_MINUTES * 2) continue;
      }

      // Idempotency: skip if already notified today
      if (session.lastNotifiedDate?.getTime() === today.getTime()) {
        continue;
      }

      try {
        const { blocks, fallback } = await buildSessionRequestMessage(
          office.id,
          office.name,
          session.label,
          session.cutoffTime,
          appUrl,
          office.locale,
        );
        await sendSlackMessage(office.slackWebhookUrl!, blocks, fallback);

        await prisma.mateSession.update({
          where: { id: session.id },
          data: { lastNotifiedDate: today },
        });

        results.push({
          office: office.name,
          session: session.label ?? session.startTime,
          ok: true,
        });
      } catch (e) {
        results.push({
          office: office.name,
          session: session.label ?? session.startTime,
          ok: false,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }
  }

  return results;
}
