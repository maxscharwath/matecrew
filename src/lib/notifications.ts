import { prisma } from "@/lib/prisma";
import {
  sendSlackMessage,
  buildSessionRequestMessage,
  buildSessionCutoffMessage,
  updateSlackMessage,
} from "@/lib/slack";
import { listRequestersByItem } from "@/lib/mate-request";
import { getActiveItems } from "@/lib/items";
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

interface NotifyOptions {
  /** Limit to one office (admin trigger). */
  officeId?: string;
  /** Notify every session of today not notified yet, whatever the time (admin trigger). */
  skipTimeWindow?: boolean;
}

interface SlackOffice {
  id: string;
  name: string;
  slackChannelId: string;
  timezone: string;
  locale: string;
}

interface DaySession {
  dayOfWeek: number;
}

/** Whether office-local `time` (HH:mm) fell within the detection window ending now. */
function isInWindow(time: string, nowMinutes: number): boolean {
  const diff = nowMinutes - timeToMinutes(time);
  return diff >= 0 && diff < SCHEDULE_STEP_MINUTES * 2;
}

/**
 * Today's sessions of each office whose `timeOf` falls in the detection
 * window (unless skipped) and that `notifiedOf` does not mark as done today.
 */
function dueSessions<S extends DaySession>(
  offices: readonly (Omit<SlackOffice, "slackChannelId"> & { slackChannelId: string | null; mateSessions: S[] })[],
  options: NotifyOptions | undefined,
  today: Date,
  timeOf: (session: S) => string,
  notifiedOf: (session: S) => Date | null,
): { office: SlackOffice; session: S }[] {
  return offices.flatMap(({ mateSessions, slackChannelId, ...office }) => {
    if (!slackChannelId) return [];
    const dayOfWeek = getDayOfWeek(office.timezone);
    const nowMinutes = timeToMinutes(getCurrentTimeInTimezone(office.timezone));
    return mateSessions
      .filter((session) => session.dayOfWeek === dayOfWeek)
      .filter((session) => options?.skipTimeWindow || isInWindow(timeOf(session), nowMinutes))
      .filter((session) => notifiedOf(session)?.getTime() !== today.getTime())
      .map((session) => ({ office: { ...office, slackChannelId }, session }));
  });
}

/** One after the other: Slack rate-limits posting to a channel. */
function inSequence<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  return items.reduce<Promise<R[]>>(
    async (previous, item) => [...(await previous), await run(item)],
    Promise.resolve([]),
  );
}

function failed(kind: string, office: string, session: string, error: unknown): NotificationResult {
  console.error(`[notifications] ${kind} failed for ${office} / ${session}:`, error);
  return {
    office,
    session,
    ok: false,
    error: error instanceof Error ? error.message : "Unknown error",
  };
}

interface StartSession extends DaySession {
  id: string;
  startTime: string;
  cutoffTime: string;
  label: string | null;
  lastNotifiedDate: Date | null;
}

/** Posts one session's request message and records it as today's. */
async function postSessionRequest(office: SlackOffice, session: StartSession, today: Date): Promise<NotificationResult> {
  const name = session.label ?? session.startTime;
  try {
    const [items, requesterGroups] = await Promise.all([
      getActiveItems(office.id),
      listRequestersByItem({
        officeId: office.id,
        mateSessionId: session.id,
        date: today,
      }),
    ]);
    const { blocks, fallback } = await buildSessionRequestMessage({
      officeId: office.id,
      officeName: office.name,
      mateSessionId: session.id,
      sessionLabel: session.label,
      cutoffTime: session.cutoffTime,
      date: toISODateString(today),
      locale: office.locale,
      items,
      requesterGroups,
    });
    const posted = await sendSlackMessage(office.slackChannelId, blocks, fallback);

    await prisma.mateSession.update({
      where: { id: session.id },
      data: {
        lastNotifiedDate: today,
        lastNotifiedMessageTs: posted.ts,
        lastNotifiedChannelId: posted.channel,
      },
    });

    return { office: office.name, session: name, ok: true };
  } catch (e) {
    return failed("daily-request", office.name, name, e);
  }
}

/**
 * Send Slack notifications for sessions whose startTime falls within the cron detection window.
 * Used by the session-notifications scheduled task (src/jobs) and skips sessions already notified today.
 */
export async function sendSessionNotifications(options?: NotifyOptions): Promise<NotificationResult[]> {
  // Single query joins offices + their sessions so the cron tick avoids the
  // N+1 roundtrip pattern and returns instantly when nothing is configured.
  const offices = await prisma.office.findMany({
    where: {
      slackChannelId: { not: null },
      ...(options?.officeId ? { id: options.officeId } : {}),
    },
    select: {
      id: true,
      name: true,
      slackChannelId: true,
      timezone: true,
      locale: true,
      mateSessions: {
        select: {
          id: true,
          dayOfWeek: true,
          startTime: true,
          cutoffTime: true,
          label: true,
          lastNotifiedDate: true,
        },
        orderBy: { startTime: "asc" },
      },
    },
  });

  if (offices.length === 0) return [];

  const today = getTodayDate();
  const due = dueSessions(
    offices,
    options,
    today,
    (session) => session.startTime,
    (session) => session.lastNotifiedDate,
  );
  return inSequence(due, ({ office, session }) => postSessionRequest(office, session, today));
}

interface CutoffSession extends DaySession {
  id: string;
  cutoffTime: string;
  label: string | null;
  cutoffNotifiedDate: Date | null;
}

/**
 * Posts one session's cutoff alert and records it as today's. Null when no
 * one registered: the session is still marked so the slot is not reprocessed
 * all day, and nothing is reported.
 */
async function postCutoffAlert(office: SlackOffice, session: CutoffSession, today: Date): Promise<NotificationResult | null> {
  const name = session.label ?? session.cutoffTime;
  try {
    const requesterGroups = await listRequestersByItem({
      officeId: office.id,
      mateSessionId: session.id,
      date: today,
      status: "REQUESTED",
    });

    if (requesterGroups.length === 0) {
      await prisma.mateSession.update({
        where: { id: session.id },
        data: { cutoffNotifiedDate: today },
      });
      return null;
    }

    const { blocks, fallback } = await buildSessionCutoffMessage({
      officeId: office.id,
      officeName: office.name,
      mateSessionId: session.id,
      sessionLabel: session.label,
      date: toISODateString(today),
      locale: office.locale,
      requesterGroups,
    });
    const posted = await sendSlackMessage(office.slackChannelId, blocks, fallback);

    await prisma.mateSession.update({
      where: { id: session.id },
      data: {
        cutoffNotifiedDate: today,
        cutoffNotifiedMessageTs: posted.ts,
        cutoffNotifiedChannelId: posted.channel,
      },
    });

    return { office: office.name, session: name, ok: true };
  } catch (e) {
    return failed("cutoff", office.name, name, e);
  }
}

/**
 * Send cutoff-time Slack alerts: "Go fetch N matés" with a "mark all served"
 * button. Mirrors `sendSessionNotifications` but keyed off `cutoffTime` and
 * `cutoffNotifiedDate`. Skips silently when no one registered.
 */
export async function sendCutoffNotifications(options?: NotifyOptions): Promise<NotificationResult[]> {
  const offices = await prisma.office.findMany({
    where: {
      slackChannelId: { not: null },
      ...(options?.officeId ? { id: options.officeId } : {}),
    },
    select: {
      id: true,
      name: true,
      slackChannelId: true,
      timezone: true,
      locale: true,
      mateSessions: {
        select: {
          id: true,
          dayOfWeek: true,
          cutoffTime: true,
          label: true,
          cutoffNotifiedDate: true,
        },
        orderBy: { cutoffTime: "asc" },
      },
    },
  });

  if (offices.length === 0) return [];

  const today = getTodayDate();
  const due = dueSessions(
    offices,
    options,
    today,
    (session) => session.cutoffTime,
    (session) => session.cutoffNotifiedDate,
  );
  const results = await inSequence(due, ({ office, session }) => postCutoffAlert(office, session, today));
  return results.filter((result): result is NotificationResult => result !== null);
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

  const [items, requesterGroups] = await Promise.all([
    getActiveItems(opts.officeId),
    listRequestersByItem({
      officeId: opts.officeId,
      mateSessionId: opts.mateSessionId,
      date: opts.date,
    }),
  ]);
  const { blocks, fallback } = await buildSessionRequestMessage({
    officeId: opts.officeId,
    officeName: office.name,
    mateSessionId: opts.mateSessionId,
    sessionLabel: session.label,
    cutoffTime: session.cutoffTime,
    date: toISODateString(opts.date),
    locale: office.locale,
    items,
    requesterGroups,
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
