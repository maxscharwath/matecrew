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
