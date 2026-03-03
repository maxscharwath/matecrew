/**
 * Returns today's date with time zeroed to midnight UTC.
 * Matches Prisma's @db.Date storage format.
 */
export function getTodayDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Formats a date for display: "3 mars 2026" style using fr-CH locale.
 */
export function formatDateDisplay(date: Date): string {
  return date.toLocaleDateString("fr-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Returns "YYYY-MM-DD" string for URL params and API use.
 */
export function toISODateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns the current time in HH:mm format for a given IANA timezone.
 */
export function getCurrentTimeInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date());
}

/**
 * Checks if the current time is past the cutoff for a given office.
 * Returns true if requests should be blocked.
 */
export function isPastCutoff(
  cutoffTime: string | null,
  timezone: string,
): boolean {
  if (!cutoffTime) return false;
  return getCurrentTimeInTimezone(timezone) >= cutoffTime;
}

/**
 * Returns the current day of week (0=Sun, 1=Mon ... 6=Sat) in the given timezone.
 */
export function getDayOfWeek(timezone: string): number {
  const dayStr = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: timezone,
  }).format(new Date());
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[dayStr];
}

/**
 * Converts HH:mm to total minutes since midnight.
 */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Session start/cutoff times must align to this interval (in minutes).
 * Must match the Vercel cron frequency so notifications fire reliably.
 */
export const SCHEDULE_STEP_MINUTES = 5;
