import { getDateInTimezone } from "@/lib/date";
import { formatTime, type TimeFormat } from "@/lib/device/clock";

/**
 * A terminal's office hours (`Device.openFrom`, `openUntil`, `openDays`): inside them it sleeps
 * between uses with the stock on its screen, outside them it shows its night screen and sleeps
 * until they start again.
 */
export type OfficeHours = {
  /** Local "HH:MM", office timezone. */
  from: string;
  until: string;
  /** 0 = Sunday ... 6 = Saturday, as `MateSession.dayOfWeek`. */
  days: number[];
};

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;

/** "1,2,3,4,5" as days; anything else dropped. */
export function parseDays(text: string): number[] {
  const days = text.split(",").map((day) => Number(day.trim()));
  return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
}

/** How far `timezone`'s clock is ahead of UTC at `instant`, in ms. */
export function zoneOffset(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant `hhmm` strikes in `timezone` on `day` (UTC midnight of the local date, as `getDateInTimezone`). */
export function zonedInstant(day: Date, hhmm: string, timezone: string): Date {
  const [hour, minute] = hhmm.split(":").map(Number);
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute);
  // Twice: the offset at the guess, not at the wall time read as UTC, around a DST change.
  const guess = wall - zoneOffset(wall, timezone);
  return new Date(wall - zoneOffset(guess, timezone));
}

export type HoursNow = {
  open: boolean;
  /** When `open` changes: the closing while open, the next opening while closed. */
  until: Date;
  /**
   * Closed for at least a whole day ahead, or all day today (a weekend, a bridge): the night
   * screen says so rather than "good night".
   */
  weekend: boolean;
};

/**
 * When the night screen says the terminal wakes up: `time` ("07:30" or "7:30 AM", its time), and `day`, the
 * weekday's name in `locale`, when that is not today or the next morning (the terminal's catalog
 * words "Réveil lundi à 07:30", or "Réveil à 07:30" without a day).
 */
export function wakeWords(
  at: Date,
  timezone: string,
  locale: string,
  now = new Date(),
  format: TimeFormat = "24",
): { day: string; time: string } {
  const midnight = (instant: Date) => getDateInTimezone(instant, timezone).getTime();
  const daysAhead = Math.round((midnight(at) - midnight(now)) / DAY_MS);
  const time = formatTime(at, timezone, format);
  const day = daysAhead > 1 ? new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "long" }).format(at) : "";
  return { day, time };
}

/** Whether the office is open at `now`, and until when; a week without opening is closed all week. */
export function hoursAt(hours: OfficeHours, timezone: string, now = new Date()): HoursNow {
  const today = getDateInTimezone(now, timezone);
  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = new Date(today.getTime() + ahead * DAY_MS);
    if (!hours.days.includes(day.getUTCDay())) continue;
    const opens = zonedInstant(day, hours.from, timezone);
    const closes = zonedInstant(day, hours.until, timezone);
    if (closes <= opens || now >= closes) continue;
    if (now >= opens) return { open: true, until: closes, weekend: false };
    const closedToday = !hours.days.includes(today.getUTCDay());
    return { open: false, until: opens, weekend: ahead >= 2 || (ahead === 1 && closedToday) };
  }
  return { open: false, until: new Date(now.getTime() + 7 * DAY_MS), weekend: true };
}
