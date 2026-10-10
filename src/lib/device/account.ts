import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getDateInTimezone } from "@/lib/date";
import { buildCostingLedger, type CostingLedger } from "@/lib/costing";
import { latestPurchases, panelMoney } from "@/lib/device/purchases";
import type { AuthenticatedDevice } from "@/lib/device/auth";
import type { DeviceAccount } from "@/lib/device/contract";

const DAY_MS = 86_400_000;
/** Days on the account's chart, today included. */
const ACCOUNT_DAYS = 7;
/** Products named on the chart; the rest stack as one "others" segment. */
const ACCOUNT_PRODUCTS = 3;

/**
 * "Mon compte" on the terminal, asked live after a badge: what the member drank today, this week
 * (from Monday), this month and on each of the last ACCOUNT_DAYS days, in the office's time zone,
 * what this month cost them, and their latest purchases. Nothing of it is kept on the terminal.
 */
export async function buildAccount(device: AuthenticatedDevice, userId: string): Promise<DeviceAccount> {
  const { office } = device;
  // One ledger for the month's cost and the purchases' prices; both stand without it.
  const ledgered = buildCostingLedger(office.id).catch(() => null);
  const [ledger, user, t, consumption, purchases] = await Promise.all([
    ledgered,
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    getTranslations({ locale: office.locale, namespace: "devices.screen" }),
    consumed(office.id, office.timezone, userId),
    ledgered.then((ledger) => latestPurchases(device, userId, ledger)),
  ]);
  return {
    name: user?.name ?? "",
    today: consumption.today,
    week: consumption.week,
    month: consumption.month,
    cost: ledger ? panelMoney(monthCost(ledger, userId, consumption.monthStart), office.locale) : null,
    ...stacks(consumption.byDay, t("others")),
    labels: dayLabels(office.timezone, office.locale),
    purchases,
  };
}

/** What the member drank since the earliest of this week, this month and the chart's first day. */
async function consumed(officeId: string, timezone: string, userId: string) {
  const today = getDateInTimezone(new Date(), timezone);
  const weekStart = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const firstDay = new Date(today.getTime() - (ACCOUNT_DAYS - 1) * DAY_MS);
  const since = new Date(Math.min(weekStart.getTime(), monthStart.getTime(), firstDay.getTime()));
  const entries = await prisma.consumptionEntry.findMany({
    where: { officeId, userId, cancelledAt: null, date: { gte: since } },
    select: { date: true, qty: true, item: { select: { name: true } } },
  });
  const counts = { today: 0, week: 0, month: 0, byDay: new Map<string, number[]>(), monthStart };
  for (const e of entries) {
    if (e.date.getTime() === today.getTime()) counts.today += e.qty;
    if (e.date >= weekStart) counts.week += e.qty;
    if (e.date >= monthStart) counts.month += e.qty;
    const day = Math.round((e.date.getTime() - firstDay.getTime()) / DAY_MS);
    if (day >= 0 && day < ACCOUNT_DAYS) {
      const days = counts.byDay.get(e.item.name) ?? new Array<number>(ACCOUNT_DAYS).fill(0);
      days[day] += e.qty;
      counts.byDay.set(e.item.name, days);
    }
  }
  return counts;
}

/**
 * The member's last days per product, for stacked bars: the products they drank most first, then
 * one `others` segment when there are more than ACCOUNT_PRODUCTS. `days[d][p]` is product `p` on
 * day `d`, oldest day first.
 */
function stacks(byDay: Map<string, number[]>, others: string): { products: string[]; days: number[][] } {
  const total = (days: number[]) => days.reduce((sum, n) => sum + n, 0);
  const ranked = [...byDay.entries()].sort((a, b) => total(b[1]) - total(a[1]) || a[0].localeCompare(b[0]));
  const named = ranked.length > ACCOUNT_PRODUCTS + 1 ? ranked.slice(0, ACCOUNT_PRODUCTS) : ranked;
  const rest = ranked.slice(named.length);
  const columns = rest.length > 0
    ? [...named, [others, Array.from({ length: ACCOUNT_DAYS }, (_, d) => rest.reduce((sum, [, days]) => sum + days[d], 0))] as const]
    : named;
  return {
    products: columns.map(([name]) => name),
    days: Array.from({ length: ACCOUNT_DAYS }, (_, d) => columns.map(([, days]) => days[d])),
  };
}

/** Francs the member drew this month, at the price the cans were bought (lib/costing.ts). */
function monthCost(ledger: CostingLedger, userId: string, monthStart: Date): number {
  let cost = 0;
  for (const draw of ledger.draws) {
    if (draw.userId !== userId || draw.at < monthStart) continue;
    if (draw.kind === "CONSUMPTION" || draw.kind === "RETURN") cost += draw.cost;
  }
  return cost;
}

/** The chart's days, oldest first: "lun" … "dim" in the office's language. */
function dayLabels(timezone: string, locale: string): string[] {
  const today = getDateInTimezone(new Date(), timezone);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: ACCOUNT_DAYS }, (_, k) =>
    weekday.format(new Date(today.getTime() - (ACCOUNT_DAYS - 1 - k) * DAY_MS)).replace(/\.$/, ""),
  );
}
