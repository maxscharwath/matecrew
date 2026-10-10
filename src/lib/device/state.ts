import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { effectiveLowStockThreshold } from "@/lib/stock";
import { getCurrentTimeInTimezone, getDateInTimezone, getDayOfWeek, getTodayDate, timeToMinutes } from "@/lib/date";
import { getSessionsForDay } from "@/lib/session-utils";
import { itemImage, smallImage } from "@/lib/device/bitmap";
import { buildCostingLedger } from "@/lib/costing";
import { formatMoney, roundCents } from "@/lib/money";
import type { AuthenticatedDevice } from "@/lib/device/auth";
import { deviceTheme, type DeviceState, type DeviceScreen } from "@/lib/device/contract";

/** Below this the terminal and the site warn that it needs charging. */
export const LOW_BATTERY_MV = 3500;
/** After a session's cutoff, the terminal shows what to prepare for this long, or until it is served. */
export const PREPARATION_MINUTES = 90;

/** Interim app download until per-device apps: `DEVICE_UI_APP` names one of `device/dist/*.dui`. */
const DOWNLOADABLE_APPS = ["hello", "showcase"] as const;
export function downloadableApp(): (typeof DOWNLOADABLE_APPS)[number] | null {
  const app = process.env.DEVICE_UI_APP;
  return DOWNLOADABLE_APPS.find((name) => name === app) ?? null;
}
/** Days of stock on the main screen's chart, today included. */
const CHART_DAYS = 14;
const CHART_MAX_ITEMS = 3;
const DAY_MS = 86_400_000;
/** Days on a person's summary chart, today included. */
const SUMMARY_DAYS = 7;
/** Products named on the chart; the rest stack as one "others" segment. */
const SUMMARY_PRODUCTS = 3;

function wifiBars(rssi: number | null): number | null {
  if (rssi == null) return null;
  return rssi > -60 ? 3 : rssi > -70 ? 2 : rssi > -80 ? 1 : 0;
}

/** Rough LiPo charge from its resting voltage: 3.3 V empty, 4.15 V full. */
function batteryPercent(mv: number | null): number | null {
  if (mv == null) return null;
  return Math.round(Math.min(100, Math.max(0, ((mv - 3300) / (4150 - 3300)) * 100)));
}

async function loadItems(officeId: string) {
  const items = await prisma.item.findMany({
    where: { officeId, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      imageKey: true,
      terminalImage: true,
      lowStockThreshold: true,
      stock: { where: { officeId }, select: { currentQty: true } },
    },
  });
  return items.map((i) => ({ ...i, qty: i.stock[0]?.currentQty ?? 0 }));
}

/** Left key takes (with a choice of item), right key shows the person's consumption. */
async function keyLabels(device: AuthenticatedDevice) {
  const t = await getTranslations({ locale: device.office.locale, namespace: "devices.keys" });
  return { left: device.leftLabel ?? t("take"), right: device.rightLabel ?? t("summary") };
}

/**
 * What each badge holder drank today, this week (from Monday), this month and on each of the last
 * SUMMARY_DAYS days, in the office's time zone, and what this month cost them.
 */
async function consumptionByUser(officeId: string, timezone: string, locale: string, others: string, userIds: string[]) {
  const today = getDateInTimezone(new Date(), timezone);
  const weekStart = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const firstDay = new Date(today.getTime() - (SUMMARY_DAYS - 1) * DAY_MS);
  const since = new Date(Math.min(weekStart.getTime(), monthStart.getTime(), firstDay.getTime()));
  const [entries, costs] = await Promise.all([
    prisma.consumptionEntry.findMany({
      where: { officeId, userId: { in: userIds }, cancelledAt: null, date: { gte: since } },
      select: { userId: true, date: true, qty: true, item: { select: { name: true } } },
    }),
    // A summary without its cost beats no state at all.
    monthCosts(officeId, monthStart).catch(() => null),
  ]);
  const empty = () => ({ today: 0, week: 0, month: 0, byDay: new Map<string, number[]>() });
  const counts = new Map<string, ReturnType<typeof empty>>();
  for (const e of entries) {
    const c = counts.get(e.userId) ?? empty();
    if (e.date.getTime() === today.getTime()) c.today += e.qty;
    if (e.date >= weekStart) c.week += e.qty;
    if (e.date >= monthStart) c.month += e.qty;
    const day = Math.round((e.date.getTime() - firstDay.getTime()) / DAY_MS);
    if (day >= 0 && day < SUMMARY_DAYS) {
      const days = c.byDay.get(e.item.name) ?? Array<number>(SUMMARY_DAYS).fill(0);
      days[day] += e.qty;
      c.byDay.set(e.item.name, days);
    }
    counts.set(e.userId, c);
  }
  return (userId: string) => {
    const { byDay, ...totals } = counts.get(userId) ?? empty();
    return {
      ...totals,
      ...stacks(byDay, others),
      cost: costs ? panelMoney(costs.get(userId) ?? 0, locale) : null,
    };
  };
}

/**
 * A person's last days per product, for stacked bars: the products they drank most first, then
 * one `others` segment when there are more than SUMMARY_PRODUCTS. `days[d][p]` is product `p` on
 * day `d`, oldest day first.
 */
function stacks(byDay: Map<string, number[]>, others: string): { products: string[]; days: number[][] } {
  const total = (days: number[]) => days.reduce((sum, n) => sum + n, 0);
  const ranked = [...byDay.entries()].sort((a, b) => total(b[1]) - total(a[1]) || a[0].localeCompare(b[0]));
  const named = ranked.length > SUMMARY_PRODUCTS + 1 ? ranked.slice(0, SUMMARY_PRODUCTS) : ranked;
  const rest = ranked.slice(named.length);
  const columns = rest.length > 0
    ? [...named, [others, Array.from({ length: SUMMARY_DAYS }, (_, d) => rest.reduce((sum, [, days]) => sum + days[d], 0))] as const]
    : named;
  return {
    products: columns.map(([name]) => name),
    days: Array.from({ length: SUMMARY_DAYS }, (_, d) => columns.map(([, days]) => days[d])),
  };
}

/** Francs each person drew this month, at the price the cans were bought (lib/costing.ts). */
async function monthCosts(officeId: string, monthStart: Date): Promise<Map<string, number>> {
  const ledger = await buildCostingLedger(officeId);
  const costs = new Map<string, number>();
  for (const draw of ledger.draws) {
    if (!draw.userId || draw.at < monthStart) continue;
    if (draw.kind !== "CONSUMPTION" && draw.kind !== "RETURN") continue;
    costs.set(draw.userId, (costs.get(draw.userId) ?? 0) + draw.cost);
  }
  return costs;
}

/** Money for the panel, whose fonts are Latin-1: plain spaces instead of no-break ones. */
function panelMoney(amount: number, locale: string): string {
  return formatMoney(roundCents(amount), locale).replace(/[\u00a0\u202f]/g, " ");
}

/** The summary chart's days, oldest first: "lun" … "dim" in the office's language. */
function dayLabels(timezone: string, locale: string): string[] {
  const today = getDateInTimezone(new Date(), timezone);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: SUMMARY_DAYS }, (_, k) =>
    weekday.format(new Date(today.getTime() - (SUMMARY_DAYS - 1 - k) * DAY_MS)).replace(/\.$/, ""),
  );
}

/** Base64 of the packed bits, which device/core decodes. */
function base64(bits: Uint8Array): string {
  return Buffer.from(bits).toString("base64");
}

export async function buildDeviceState(device: AuthenticatedDevice): Promise<DeviceState> {
  const { office } = device;
  const [items, badges, labels] = await Promise.all([
    loadItems(office.id),
    prisma.badge.findMany({
      where: { officeId: office.id, userId: { not: null } },
      select: { uid: true, userId: true, user: { select: { name: true } } },
    }),
    keyLabels(device),
  ]);
  const release = await prisma.firmwareRelease.findFirst({ orderBy: { createdAt: "desc" } });
  const screenT = await getTranslations({ locale: office.locale, namespace: "devices.screen" });
  const stats = await consumptionByUser(
    office.id,
    office.timezone,
    office.locale,
    screenT("others"),
    badges.map((b) => b.userId).filter((id): id is string => id !== null),
  );
  // The picker opens on the left key's item; the rest follow in shelf order.
  const first = items.findIndex((i) => i.id === device.leftItemId);
  const ordered = first > 0 ? [items[first], ...items.filter((_, i) => i !== first)] : items;

  return {
    device: { id: device.id, name: device.name },
    office: { name: office.name, timezone: office.timezone, locale: office.locale },
    keys: {
      left: { action: "TAKE", itemId: ordered[0]?.id ?? null, label: labels.left },
      right: { action: "RETURN", itemId: null, label: labels.right },
    },
    items: await Promise.all(
      ordered.map(async (i) => ({ id: i.id, name: i.name, stock: i.qty, image: base64(smallImage(await itemImage(i.imageKey, i.terminalImage)).bits) })),
    ),
    badges: badges.map((b) => ({ uid: b.uid, name: b.user?.name ?? "", ...stats(b.userId ?? "") })),
    dayLabels: dayLabels(office.timezone, office.locale),
    syncTimes: await syncTimes(office.id, office.timezone, device.syncTimes),
    serverTime: new Date().toISOString(),
    screen: await buildScreenData(device, { items, labels }),
    appUrl: downloadableApp() ? "/api/device/ui" : null,
    theme: deviceTheme.catch("paper").parse(process.env.DEVICE_UI_THEME ?? "paper"),
    firmware: release && {
      version: release.version,
      url: `/api/device/firmware/${encodeURIComponent(release.version)}`,
      sha256: release.sha256,
      size: release.size,
    },
  };
}

/** The device's own times plus today's cutoffs, so it wakes up for each preparation. */
async function syncTimes(officeId: string, timezone: string, own: string[]): Promise<string[]> {
  const sessions = await getSessionsForDay(officeId, getDayOfWeek(timezone));
  return [...new Set([...own, ...sessions.map((s) => s.cutoffTime)])].sort();
}

/**
 * Stock at the end of each of the last CHART_DAYS days, per item: today's
 * stock minus every movement after that day.
 */
async function stockHistory(officeId: string, timezone: string, items: { id: string; qty: number }[]) {
  const today = getDateInTimezone(new Date(), timezone);
  const movements = await prisma.stockMovement.findMany({
    where: { officeId, createdAt: { gte: new Date(Date.now() - (CHART_DAYS + 1) * DAY_MS) } },
    select: { itemId: true, delta: true, createdAt: true },
  });
  const days = Array.from({ length: CHART_DAYS }, (_, k) => today.getTime() - (CHART_DAYS - 1 - k) * DAY_MS);
  return items.map((item) => {
    const own = movements
      .filter((m) => m.itemId === item.id)
      .map((m) => ({ day: getDateInTimezone(m.createdAt, timezone).getTime(), delta: m.delta }));
    return days.map((day) => item.qty - own.filter((m) => m.day > day).reduce((sum, m) => sum + m.delta, 0));
  });
}

/**
 * The session whose requests are to be prepared now: its cutoff has passed
 * less than PREPARATION_MINUTES ago and some requests are not served yet.
 */
async function preparation(officeId: string, timezone: string) {
  const now = timeToMinutes(getCurrentTimeInTimezone(timezone));
  const sessions = await getSessionsForDay(officeId, getDayOfWeek(timezone));
  const session = sessions
    .filter((s) => now >= timeToMinutes(s.cutoffTime) && now < timeToMinutes(s.cutoffTime) + PREPARATION_MINUTES)
    .at(-1);
  if (!session) return null;
  const requests = await prisma.dailyRequest.findMany({
    where: { officeId, date: getTodayDate(), mateSessionId: session.id, status: "REQUESTED" },
    orderBy: { createdAt: "asc" },
    select: {
      item: { select: { id: true, name: true, imageKey: true, terminalImage: true } },
      user: { select: { name: true } },
    },
  });
  if (requests.length === 0) return null;
  const byItem = new Map<string, { name: string; imageKey: string | null; terminalImage: Uint8Array | null; names: string[] }>();
  for (const r of requests) {
    const entry = byItem.get(r.item.id) ?? {
      name: r.item.name,
      imageKey: r.item.imageKey,
      terminalImage: r.item.terminalImage,
      names: [],
    };
    entry.names.push(r.user.name.split(" ")[0]);
    byItem.set(r.item.id, entry);
  }
  return { sessionId: session.id, label: session.label, total: requests.length, items: [...byItem.values()] };
}

export async function buildScreenData(
  device: AuthenticatedDevice,
  loaded?: { items: Awaited<ReturnType<typeof loadItems>>; labels: Awaited<ReturnType<typeof keyLabels>> },
): Promise<DeviceScreen> {
  const { office } = device;
  const [items, labels, t, prep] = await Promise.all([
    loaded ? Promise.resolve(loaded.items) : loadItems(office.id),
    loaded ? Promise.resolve(loaded.labels) : keyLabels(device),
    getTranslations({ locale: office.locale, namespace: "devices.screen" }),
    preparation(office.id, office.timezone),
  ]);
  const time = new Intl.DateTimeFormat(office.locale, {
    timeZone: office.timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  const thresholds = items.map((i) => effectiveLowStockThreshold(i.lowStockThreshold, office.lowStockThreshold));
  // Larger catalogues use aggregate history, keeping the graph present without an unreadable legend.
  const allHistory = items.length ? await stockHistory(office.id, office.timezone, items) : [];
  const aggregate = items.length > CHART_MAX_ITEMS;
  const history = aggregate
    ? [Array.from({ length: CHART_DAYS }, (_, day) => allHistory.reduce((sum, series) => sum + series[day], 0))]
    : allHistory;
  const max = Math.max(10, ...history.flat());
  const chartMax = Math.ceil(max / 10) * 10;

  return {
    version: 1,
    template: "dashboard",
    officeName: office.name,
    time,
    wifiBars: wifiBars(device.wifiRssi),
    batteryPercent: batteryPercent(device.batteryMv),
    batteryLowLabel: device.batteryMv != null && device.batteryMv < LOW_BATTERY_MV ? t("batteryLow") : null,
    items: await Promise.all(
      items.map(async (i, index) => ({
        name: i.name,
        stock: i.qty,
        low: i.qty <= thresholds[index],
        image: base64(smallImage(await itemImage(i.imageKey, i.terminalImage)).bits),
      })),
    ),
    chart:
      items.length > 0
        ? {
            series: history,
            max: chartMax,
            days: CHART_DAYS,
          }
        : null,
    preparation: prep && {
      title: prep.label ? t("preparationOf", { label: prep.label }) : t("preparation"),
      total: t("toPrepare", { count: prep.total }),
      items: await Promise.all(
        prep.items.map(async (i) => ({
          name: i.name,
          count: i.names.length,
          names: i.names.join(", "),
          image: base64(smallImage(await itemImage(i.imageKey, i.terminalImage)).bits),
        })),
      ),
      sessionId: prep.sessionId,
      serveLabel: t("serve"),
    },
    lowLabel: t("lowStock"),
    moreLabel: t("more"),
    chartLabel: t(aggregate ? "chartTotal" : "chart", { days: CHART_DAYS }),
    leftLabel: labels.left,
    rightLabel: labels.right,
  };
}
