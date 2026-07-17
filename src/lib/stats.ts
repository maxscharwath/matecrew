import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { getTodayDate } from "@/lib/date";

/**
 * Aggregated consumption stats for the office stats screen.
 * Everything is computed from non-cancelled ConsumptionEntry rows in a single
 * pass — office teams are small, so fetching the raw rows is cheap.
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

export interface UserStats {
  userId: string;
  name: string;
  image?: string;
  qty: number;
  liters: number;
  sugarGrams: number;
  caffeineMg: number;
  /** Habitual intake: totals over the last 30 calendar days / 30. */
  avgSugarPerDay: number;
  avgCaffeinePerDay: number;
  sugarRisk: RiskLevel;
  caffeineRisk: RiskLevel;
}

export interface OfficeStats {
  totals: {
    officeQty: number;
    officeLiters: number;
    monthOfficeQty: number;
    activeDrinkers: number;
  };
  /** Last 12 months, oldest first. `month` is "YYYY-MM". */
  monthly: { month: string; mine: number; others: number }[];
  /** All-time quantity per item, descending. */
  byItem: { name: string; qty: number }[];
  /** Sorted by all-time quantity, descending. Only users who consumed. */
  users: UserStats[];
  /** The requesting user's row (zeroed if they never consumed). */
  me: UserStats;
}

export async function getOfficeStats(
  officeId: string,
  userId: string,
): Promise<OfficeStats> {
  const today = getTodayDate();
  const last30Start = new Date(today);
  last30Start.setUTCDate(today.getUTCDate() - 29);

  const [entries, items, memberships] = await Promise.all([
    prisma.consumptionEntry.findMany({
      where: { officeId, cancelledAt: null },
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

  // Last 12 months buckets, oldest first.
  const monthKeys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    monthKeys.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  const monthlyMine = new Map(monthKeys.map((k) => [k, 0]));
  const monthlyOthers = new Map(monthKeys.map((k) => [k, 0]));

  const qtyByItem = new Map<string, number>();
  const perUser = new Map<
    string,
    { qty: number; liters: number; sugar: number; caffeine: number; sugar30: number; caffeine30: number }
  >();

  const currentMonthKey = monthKeys[monthKeys.length - 1];
  let officeQty = 0;
  let officeLiters = 0;
  let monthOfficeQty = 0;
  const activeDrinkerIds = new Set<string>();

  for (const e of entries) {
    const item = itemById.get(e.itemId);
    if (!item) continue;

    const liters = (e.qty * item.volumeMl) / 1000;
    const sugar = e.qty * item.sugarGrams;
    const caffeine = e.qty * item.caffeineMg;

    officeQty += e.qty;
    officeLiters += liters;
    qtyByItem.set(e.itemId, (qtyByItem.get(e.itemId) ?? 0) + e.qty);

    const monthKey = `${e.date.getUTCFullYear()}-${String(e.date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (monthKey === currentMonthKey) monthOfficeQty += e.qty;
    if (monthlyMine.has(monthKey)) {
      const bucket = e.userId === userId ? monthlyMine : monthlyOthers;
      bucket.set(monthKey, (bucket.get(monthKey) ?? 0) + e.qty);
    }

    const inLast30 = e.date.getTime() >= last30Start.getTime();
    if (inLast30) activeDrinkerIds.add(e.userId);

    const u = perUser.get(e.userId) ?? {
      qty: 0,
      liters: 0,
      sugar: 0,
      caffeine: 0,
      sugar30: 0,
      caffeine30: 0,
    };
    u.qty += e.qty;
    u.liters += liters;
    u.sugar += sugar;
    u.caffeine += caffeine;
    if (inLast30) {
      u.sugar30 += sugar;
      u.caffeine30 += caffeine;
    }
    perUser.set(e.userId, u);
  }

  function toUserStats(id: string): UserStats {
    const u = perUser.get(id);
    const info = userById.get(id);
    const avgSugarPerDay = (u?.sugar30 ?? 0) / 30;
    const avgCaffeinePerDay = (u?.caffeine30 ?? 0) / 30;
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
    };
  }

  const users = [...perUser.keys()]
    .map(toUserStats)
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  const byItem = [...qtyByItem.entries()]
    .map(([itemId, qty]) => ({ name: itemById.get(itemId)?.name ?? "?", qty }))
    .sort((a, b) => b.qty - a.qty);

  return {
    totals: {
      officeQty,
      officeLiters,
      monthOfficeQty,
      activeDrinkers: activeDrinkerIds.size,
    },
    monthly: monthKeys.map((month) => ({
      month,
      mine: monthlyMine.get(month) ?? 0,
      others: monthlyOthers.get(month) ?? 0,
    })),
    byItem,
    users,
    me: toUserStats(userId),
  };
}
