import { zoneOffset } from "@/lib/device/hours";

/**
 * How a terminal tells the time (`Device.timeFormat`, `Device.timezone`): 24-hour figures
 * ("14:05") or 12-hour ones ("2:05 PM"), in its own time zone or its office's. The terminal reads
 * the clock itself from its UTC time and the offset the state gives (`clock`); what the site
 * words for it (the night screen's wake-up, purchase times) is formatted here the same way.
 */
export const TIME_FORMATS = ["24", "12"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

type ClockSettings = { timezone: string | null; timeFormat: string; office: { timezone: string } };

/** The time zone the terminal shows its times in: its own, else its office's. */
export function deviceTimeZone(device: ClockSettings): string {
  return device.timezone ?? device.office.timezone;
}

export function timeFormatOf(device: ClockSettings): TimeFormat {
  return device.timeFormat === "12" ? "12" : "24";
}

/** Whether `name` is a time zone this runtime knows ("Europe/Zurich"). */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const HOUR_MINUTE = new Map<string, Intl.DateTimeFormat>();

/** "14:05" or "2:05 PM" at `at` in `timeZone`, as the terminal writes its clock (`Clock::text`). */
export function formatTime(at: Date, timeZone: string, format: TimeFormat): string {
  let parts = HOUR_MINUTE.get(timeZone);
  if (!parts) {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
    HOUR_MINUTE.set(timeZone, parts);
  }
  const read = parts.formatToParts(at);
  const hour = Number(read.find((p) => p.type === "hour")?.value) % 24;
  const minute = read.find((p) => p.type === "minute")?.value ?? "00";
  if (format === "24") return `${String(hour).padStart(2, "0")}:${minute}`;
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

/** Minutes east of UTC in `timeZone` at `at`. */
export function utcOffset(at: Date, timeZone: string): number {
  return Math.round(zoneOffset(at.getTime(), timeZone) / 60_000);
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/**
 * The next change of `timeZone`'s offset within `days` (summer or winter time), to the minute:
 * when, and the offset after it. The terminal switches then by itself, asleep or not.
 */
export function nextOffsetChange(timeZone: string, now = new Date(), days = 8): { at: Date; offset: number } | null {
  const current = utcOffset(now, timeZone);
  const start = Math.floor(now.getTime() / MINUTE) * MINUTE;
  for (let after = start + HOUR; after <= start + days * 24 * HOUR; after += HOUR) {
    const offset = utcOffset(new Date(after), timeZone);
    if (offset === current) continue;
    // Changed within this hour: the first minute that has the new offset.
    let [before, at] = [after - HOUR, after];
    while (at - before > MINUTE) {
      const middle = before + Math.floor((at - before) / 2 / MINUTE) * MINUTE;
      if (utcOffset(new Date(middle), timeZone) === current) before = middle;
      else at = middle;
    }
    return { at: new Date(at), offset };
  }
  return null;
}

/** The state's `clock`: the terminal's offset now, its next change, and its figures. */
export function deviceClock(device: ClockSettings, now = new Date()) {
  const timeZone = deviceTimeZone(device);
  const next = nextOffsetChange(timeZone, now);
  return {
    offset: utcOffset(now, timeZone),
    next: next && { at: next.at.toISOString(), offset: next.offset },
    format: timeFormatOf(device),
  };
}
