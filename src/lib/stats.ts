import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { getTodayDate } from "@/lib/date";
import { DEFAULT_STATS_PERIOD, type StatsPeriod } from "@/lib/stats-period";

export {
  STATS_PERIODS,
  DEFAULT_STATS_PERIOD,
  parseStatsPeriod,
  type StatsPeriod,
} from "@/lib/stats-period";

/**
 * Aggregated consumption stats for the office stats screen.
 * Everything is computed from non-cancelled ConsumptionEntry rows in a single
 * pass — office teams are small, so fetching the raw rows is cheap.
 *
 * Every number on the screen is scoped to one selected period, so mixes and
 * daily averages stay comparable (an item added last month no longer looks
 * marginal next to one that has been on the shelf all year).
 */

/** WHO free-sugar guidance: < 25 g/day ideal, < 50 g/day max. */
export const SUGAR_IDEAL_G_PER_DAY = 25;
export const SUGAR_MAX_G_PER_DAY = 50;
/** EFSA safe habitual caffeine intake for adults: 400 mg/day. */
export const CAFFEINE_MAX_MG_PER_DAY = 400;
export const CAFFEINE_MODERATE_MG_PER_DAY = 200;

export type RiskLevel = "low" | "moderate" | "high";

export function sugarRiskLevel(avgPerDay: number): RiskLevel {
  if (avgPerDay >= SUGAR_MAX_G_PER_DAY) return "high";
  if (avgPerDay >= SUGAR_IDEAL_G_PER_DAY) return "moderate";
  return "low";
}

export function caffeineRiskLevel(avgPerDay: number): RiskLevel {
  if (avgPerDay >= CAFFEINE_MAX_MG_PER_DAY) return "high";
  if (avgPerDay >= CAFFEINE_MODERATE_MG_PER_DAY) return "moderate";
  return "low";
}

// ── Periods ──────────────────────────────────────────────

/** Timeline bucket width — picked from the range length, never by the caller. */
export type Granularity = "day" | "week" | "month";

/**
 * Inclusive UTC-midnight start of a period, or `null` for "since the first
 * entry". Month-based periods snap to the 1st so monthly buckets are whole.
 */
function periodStart(period: StatsPeriod, today: Date): Date | null {
  switch (period) {
    case "wtd":
      return weekStart(today);
    case "30d":
      return addDays(today, -29);
    case "90d":
      return addDays(today, -89);
    case "12m":
      return utcMonthStart(today.getUTCFullYear(), today.getUTCMonth() - 11);
    case "ytd":
      return utcMonthStart(today.getUTCFullYear(), 0);
    case "all":
      return null;
  }
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function utcMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Monday of the week containing `date`. */
function weekStart(date: Date): Date {
  return addDays(date, -((date.getUTCDay() + 6) % 7));
}

const MS_PER_DAY = 86_400_000;

function pickGranularity(days: number): Granularity {
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  return "month";
}

function bucketKey(date: Date, granularity: Granularity): string {
  if (granularity === "month") return monthKey(date);
  if (granularity === "week") return dayKey(weekStart(date));
  return dayKey(date);
}

/** Every bucket in [start, end], oldest first — including the empty ones. */
function bucketKeys(start: Date, end: Date, granularity: Granularity): string[] {
  const keys: string[] = [];
  if (granularity === "month") {
    let cursor = utcMonthStart(start.getUTCFullYear(), start.getUTCMonth());
    const last = utcMonthStart(end.getUTCFullYear(), end.getUTCMonth());
    while (cursor <= last) {
      keys.push(monthKey(cursor));
      cursor = utcMonthStart(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1);
    }
    return keys;
  }
  const step = granularity === "week" ? 7 : 1;
  let cursor = granularity === "week" ? weekStart(start) : new Date(start);
  while (cursor <= end) {
    keys.push(dayKey(cursor));
    cursor = addDays(cursor, step);
  }
  return keys;
}

// ── Shapes ───────────────────────────────────────────────

export interface UserStats {
  userId: string;
  name: string;
  image?: string;
  qty: number;
  liters: number;
  sugarGrams: number;
  caffeineMg: number;
  /** Period totals spread over every calendar day of the period. */
  avgSugarPerDay: number;
  avgCaffeinePerDay: number;
  sugarRisk: RiskLevel;
  caffeineRisk: RiskLevel;
  /** Quantity per item id — the taste profile. Missing key means zero. */
  qtyByItem: Record<string, number>;
}

export interface ItemStats {
  itemId: string;
  name: string;
  qty: number;
}

export interface OfficeStats {
  period: StatsPeriod;
  range: {
    /** "YYYY-MM-DD", inclusive. Resolved: for "all" this is the first entry. */
    start: string;
    /** "YYYY-MM-DD", inclusive (today). */
    end: string;
    /** Calendar days covered — the divisor behind every per-day average. */
    days: number;
  };
  totals: {
    officeQty: number;
    officeLiters: number;
    /** Office cans per calendar day over the period. */
    officeQtyPerDay: number;
    activeDrinkers: number;
  };
  granularity: Granularity;
  /** Consumption per bucket, oldest first. `key` is "YYYY-MM-DD" or "YYYY-MM". */
  timeline: { key: string; mine: number; others: number }[];
  /** Quantity per item over the period, descending. */
  byItem: ItemStats[];
  /** Sorted by period quantity, descending. Only users who consumed. */
  users: UserStats[];
  /** The requesting user's row (zeroed if they never consumed). */
  me: UserStats;
}

export async function getOfficeStats(
  officeId: string,
  userId: string,
  period: StatsPeriod = DEFAULT_STATS_PERIOD,
): Promise<OfficeStats> {
  const today = getTodayDate();
  const start = periodStart(period, today);

  const [entries, items, memberships] = await Promise.all([
    prisma.consumptionEntry.findMany({
      where: {
        officeId,
        cancelledAt: null,
        date: { ...(start ? { gte: start } : {}), lte: today },
      },
      select: { date: true, qty: true, itemId: true, userId: true },
    }),
    prisma.item.findMany({
      where: { officeId },
      select: {
        id: true,
        name: true,
        volumeMl: true,
        sugarGrams: true,
        caffeineMg: true,
      },
    }),
    prisma.membership.findMany({
      where: { officeId },
      select: { user: { select: { id: true, name: true, image: true } } },
    }),
  ]);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const userById = new Map(memberships.map((m) => [m.user.id, m.user]));

  // "All time" starts at the first entry; anything else has a fixed start.
  const firstEntry = entries.reduce<Date | null>(
    (min, e) => (min === null || e.date < min ? e.date : min),
    null,
  );
  const rangeStart = start ?? firstEntry ?? today;
  const days =
    Math.floor((today.getTime() - rangeStart.getTime()) / MS_PER_DAY) + 1;
  const granularity = pickGranularity(days);

  const keys = bucketKeys(rangeStart, today, granularity);
  const mineByBucket = new Map(keys.map((k) => [k, 0]));
  const othersByBucket = new Map(keys.map((k) => [k, 0]));

  const qtyByItem = new Map<string, number>();
  const perUser = new Map<
    string,
    {
      qty: number;
      liters: number;
      sugar: number;
      caffeine: number;
      qtyByItem: Record<string, number>;
    }
  >();

  let officeQty = 0;
  let officeLiters = 0;
  const activeDrinkerIds = new Set<string>();

  for (const e of entries) {
    const item = itemById.get(e.itemId);
    if (!item) continue;

    const liters = (e.qty * item.volumeMl) / 1000;

    officeQty += e.qty;
    officeLiters += liters;
    qtyByItem.set(e.itemId, (qtyByItem.get(e.itemId) ?? 0) + e.qty);
    activeDrinkerIds.add(e.userId);

    const key = bucketKey(e.date, granularity);
    const bucket = e.userId === userId ? mineByBucket : othersByBucket;
    if (bucket.has(key)) bucket.set(key, (bucket.get(key) ?? 0) + e.qty);

    const u = perUser.get(e.userId) ?? {
      qty: 0,
      liters: 0,
      sugar: 0,
      caffeine: 0,
      qtyByItem: {},
    };
    u.qty += e.qty;
    u.liters += liters;
    u.sugar += e.qty * item.sugarGrams;
    u.caffeine += e.qty * item.caffeineMg;
    u.qtyByItem[e.itemId] = (u.qtyByItem[e.itemId] ?? 0) + e.qty;
    perUser.set(e.userId, u);
  }

  function toUserStats(id: string): UserStats {
    const u = perUser.get(id);
    const info = userById.get(id);
    const avgSugarPerDay = (u?.sugar ?? 0) / days;
    const avgCaffeinePerDay = (u?.caffeine ?? 0) / days;
    return {
      userId: id,
      name: info?.name ?? "?",
      image: resolveAvatarUrl(info?.image ?? null),
      qty: u?.qty ?? 0,
      liters: u?.liters ?? 0,
      sugarGrams: u?.sugar ?? 0,
      caffeineMg: u?.caffeine ?? 0,
      avgSugarPerDay,
      avgCaffeinePerDay,
      sugarRisk: sugarRiskLevel(avgSugarPerDay),
      caffeineRisk: caffeineRiskLevel(avgCaffeinePerDay),
      qtyByItem: u?.qtyByItem ?? {},
    };
  }

  const users = [...perUser.keys()]
    .map(toUserStats)
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  const byItem = [...qtyByItem.entries()]
    .map(([itemId, qty]) => ({
      itemId,
      name: itemById.get(itemId)?.name ?? "?",
      qty,
    }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  return {
    period,
    range: { start: dayKey(rangeStart), end: dayKey(today), days },
    totals: {
      officeQty,
      officeLiters,
      officeQtyPerDay: officeQty / days,
      activeDrinkers: activeDrinkerIds.size,
    },
    granularity,
    timeline: keys.map((key) => ({
      key,
      mine: mineByBucket.get(key) ?? 0,
      others: othersByBucket.get(key) ?? 0,
    })),
    byItem,
    users,
    me: toUserStats(userId),
  };
}
