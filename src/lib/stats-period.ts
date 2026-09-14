/**
 * Stats period vocabulary — shared by the server aggregation (`@/lib/stats`,
 * which is server-only) and the client period filter.
 */

export const STATS_PERIODS = ["wtd", "30d", "90d", "12m", "ytd", "all"] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

/**
 * Recent enough that the item mix reflects what the office actually stocks
 * today, and it matches the 30-day window the health meters are calibrated on.
 */
export const DEFAULT_STATS_PERIOD: StatsPeriod = "30d";

export function parseStatsPeriod(value: unknown): StatsPeriod {
  return STATS_PERIODS.includes(value as StatsPeriod)
    ? (value as StatsPeriod)
    : DEFAULT_STATS_PERIOD;
}

/** An explicit range typed into the date picker, in place of a preset. */
export interface StatsRange {
  /** Inclusive UTC-midnight bounds. */
  start: Date;
  end: Date;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** UTC midnight of a "YYYY-MM-DD" string, or null if it is not one. */
export function parseIsoDay(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  // Rejects the ones that pass the shape but not the calendar (2026-02-31).
  return Number.isNaN(date.getTime()) || toIsoDay(date) !== value ? null : date;
}

export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The `?from=&to=` pair as a usable range, or null to fall back to the preset.
 *
 * Both bounds are required — half a range is not a range — and they are
 * ordered and clipped to today rather than rejected, so a swapped pair or a
 * date in the future still shows the days it can instead of an error.
 */
export function parseStatsRange(
  from: unknown,
  to: unknown,
  today: Date,
): StatsRange | null {
  const a = parseIsoDay(from);
  const b = parseIsoDay(to);
  if (!a || !b) return null;
  const [start, end] = a <= b ? [a, b] : [b, a];
  if (start > today) return null;
  return { start, end: end > today ? today : end };
}
