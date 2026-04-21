import { prisma } from "@/lib/prisma";
import {
  sendSlackMessage,
  buildSessionRequestMessage,
  updateSlackMessage,
} from "@/lib/slack";
import { listRequesterNames } from "@/lib/mate-request";
import {
  getDayOfWeek,
  getCurrentTimeInTimezone,
  timeToMinutes,
  getTodayDate,
  toISODateString,
  SCHEDULE_STEP_MINUTES,
} from "@/lib/date";

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
      slackChannelId: { not: null },
      ...(options?.officeId ? { id: options.officeId } : {}),
    },
    select: { id: true, name: true, slackChannelId: true, timezone: true, locale: true },
  });

  const today = getTodayDate();
  const todayIso = toISODateString(today);
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
        const requesters = await listRequesterNames({
          officeId: office.id,
          mateSessionId: session.id,
          date: today,
        });
        const { blocks, fallback } = await buildSessionRequestMessage({
          officeId: office.id,
          officeName: office.name,
          mateSessionId: session.id,
          sessionLabel: session.label,
          cutoffTime: session.cutoffTime,
          date: todayIso,
          locale: office.locale,
          requesters,
        });
        const posted = await sendSlackMessage(
          office.slackChannelId!,
          blocks,
          fallback,
        );

        await prisma.mateSession.update({
          where: { id: session.id },
          data: {
            lastNotifiedDate: today,
            lastNotifiedMessageTs: posted.ts,
            lastNotifiedChannelId: posted.channel,
          },
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

/**
 * Refreshes the previously posted Slack message for a session so the visible
 * requester list stays in sync after create/cancel actions (from either the
 * Slack buttons or the web UI). Silently no-ops when no ts was saved yet.
 */
export async function refreshSlackSessionMessage(opts: {
  officeId: string;
  mateSessionId: string | null;
  date: Date;
}): Promise<void> {
  if (!opts.mateSessionId) return;

  const [session, office] = await Promise.all([
    prisma.mateSession.findUnique({
      where: { id: opts.mateSessionId },
      select: {
        label: true,
        cutoffTime: true,
        lastNotifiedMessageTs: true,
        lastNotifiedChannelId: true,
      },
    }),
    prisma.office.findUnique({
      where: { id: opts.officeId },
      select: { name: true, locale: true },
    }),
  ]);
  if (!session?.lastNotifiedMessageTs || !session.lastNotifiedChannelId) {
    return;
  }
  if (!office) return;

  const requesters = await listRequesterNames({
    officeId: opts.officeId,
    mateSessionId: opts.mateSessionId,
    date: opts.date,
  });
  const { blocks, fallback } = await buildSessionRequestMessage({
    officeId: opts.officeId,
    officeName: office.name,
    mateSessionId: opts.mateSessionId,
    sessionLabel: session.label,
    cutoffTime: session.cutoffTime,
    date: toISODateString(opts.date),
    locale: office.locale,
    requesters,
  });

  try {
    await updateSlackMessage({
      channel: session.lastNotifiedChannelId,
      ts: session.lastNotifiedMessageTs,
      blocks,
      text: fallback,
    });
  } catch {
    // non-fatal: the DB state is authoritative
  }
}
