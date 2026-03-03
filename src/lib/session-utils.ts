import { prisma } from "@/lib/prisma";
import { getCurrentTimeInTimezone, getDayOfWeek } from "@/lib/date";

export interface SessionInfo {
  id: string;
  officeId: string;
  dayOfWeek: number;
  startTime: string;
  cutoffTime: string;
  label: string | null;
}

/**
 * All sessions for an office on a given day of week, ordered by startTime.
 */
export async function getSessionsForDay(
  officeId: string,
  dayOfWeek: number,
): Promise<SessionInfo[]> {
  return prisma.mateSession.findMany({
    where: { officeId, dayOfWeek },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      officeId: true,
      dayOfWeek: true,
      startTime: true,
      cutoffTime: true,
      label: true,
    },
  });
}

/**
 * Find the currently active session (startTime <= now < cutoffTime).
 */
export async function getActiveSession(
  officeId: string,
  timezone: string,
): Promise<SessionInfo | null> {
  const dayOfWeek = getDayOfWeek(timezone);
  const currentTime = getCurrentTimeInTimezone(timezone);
  const sessions = await getSessionsForDay(officeId, dayOfWeek);

  return (
    sessions.find(
      (s) => currentTime >= s.startTime && currentTime < s.cutoffTime,
    ) ?? null
  );
}

/**
 * Find the next upcoming session (today or next days).
 */
export async function getNextSession(
  officeId: string,
  timezone: string,
): Promise<{ session: SessionInfo; isToday: boolean } | null> {
  const dayOfWeek = getDayOfWeek(timezone);
  const currentTime = getCurrentTimeInTimezone(timezone);

  // Remaining sessions today (not yet started)
  const todaySessions = await getSessionsForDay(officeId, dayOfWeek);
  const upcoming = todaySessions.find((s) => s.startTime > currentTime);
  if (upcoming) return { session: upcoming, isToday: true };

  // Check next 7 days
  for (let i = 1; i <= 7; i++) {
    const nextDay = (dayOfWeek + i) % 7;
    const nextDaySessions = await getSessionsForDay(officeId, nextDay);
    if (nextDaySessions.length > 0) {
      return { session: nextDaySessions[0], isToday: false };
    }
  }

  return null;
}

/**
 * Most recent session that has already started today (for runner default).
 */
export async function getMostRecentSession(
  officeId: string,
  timezone: string,
): Promise<SessionInfo | null> {
  const dayOfWeek = getDayOfWeek(timezone);
  const currentTime = getCurrentTimeInTimezone(timezone);
  const sessions = await getSessionsForDay(officeId, dayOfWeek);

  const started = sessions.filter((s) => s.startTime <= currentTime);
  return started.length > 0 ? started[started.length - 1] : null;
}

/**
 * Check if requests are currently open for a session.
 */
export function isSessionOpen(
  session: { startTime: string; cutoffTime: string },
  timezone: string,
): boolean {
  const currentTime = getCurrentTimeInTimezone(timezone);
  return currentTime >= session.startTime && currentTime < session.cutoffTime;
}
