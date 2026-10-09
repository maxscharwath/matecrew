import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { effectiveLowStockThreshold } from "@/lib/stock";
import { getCurrentTimeInTimezone, getDateInTimezone, getDayOfWeek, getTodayDate, timeToMinutes } from "@/lib/date";
import { getSessionsForDay } from "@/lib/session-utils";
import { itemImage, stockChart, toPngDataUrl, patternSample } from "@/lib/device/bitmap";
import type { AuthenticatedDevice } from "@/lib/device/auth";
import type { DeviceState } from "@/lib/device/contract";
import { CHART_HEIGHT, CHART_WIDTH, type ScreenData } from "@/lib/device/screen";

/** Below this the terminal and the site warn that it needs charging. */
export const LOW_BATTERY_MV = 3500;
/** After a session's cutoff, the terminal shows what to prepare for this long, or until it is served. */
export const PREPARATION_MINUTES = 90;
/** Days of stock on the main screen's chart, today included. */
const CHART_DAYS = 14;
const CHART_MAX_ITEMS = 3;
const DAY_MS = 86_400_000;

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

/** What each badge holder drank today, this week (from Monday) and this month, in the office's time zone. */
async function consumptionByUser(officeId: string, timezone: string, userIds: string[]) {
  const today = getDateInTimezone(new Date(), timezone);
  const weekStart = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const since = new Date(Math.min(weekStart.getTime(), monthStart.getTime()));
  const entries = await prisma.consumptionEntry.findMany({
    where: { officeId, userId: { in: userIds }, cancelledAt: null, date: { gte: since } },
    select: { userId: true, date: true, qty: true },
  });
  const counts = new Map<string, { today: number; week: number; month: number }>();
  for (const e of entries) {
    const c = counts.get(e.userId) ?? { today: 0, week: 0, month: 0 };
    if (e.date.getTime() === today.getTime()) c.today += e.qty;
    if (e.date >= weekStart) c.week += e.qty;
    if (e.date >= monthStart) c.month += e.qty;
    counts.set(e.userId, c);
  }
  return (userId: string) => counts.get(userId) ?? { today: 0, week: 0, month: 0 };
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
  const stats = await consumptionByUser(
    office.id,
    office.timezone,
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
      ordered.map(async (i) => ({ id: i.id, name: i.name, stock: i.qty, image: base64((await itemImage(i.imageKey, i.terminalImage)).bits) })),
    ),
    badges: badges.map((b) => ({ uid: b.uid, name: b.user?.name ?? "", ...stats(b.userId ?? "") })),
    syncTimes: await syncTimes(office.id, office.timezone, device.syncTimes),
    serverTime: new Date().toISOString(),
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
  return { label: session.label, total: requests.length, items: [...byItem.values()] };
}

export async function buildScreenData(device: AuthenticatedDevice): Promise<ScreenData> {
  const { office } = device;
  const [items, labels, t, prep] = await Promise.all([
    loadItems(office.id),
    keyLabels(device),
    getTranslations({ locale: office.locale, namespace: "devices.screen" }),
    preparation(office.id, office.timezone),
  ]);
  const time = new Intl.DateTimeFormat(office.locale, {
    timeZone: office.timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  const thresholds = items.map((i) => effectiveLowStockThreshold(i.lowStockThreshold, office.lowStockThreshold));
  // The chart only fits next to three items or fewer: one line style each.
  const charted = items.length <= CHART_MAX_ITEMS ? items : [];
  const history = await stockHistory(office.id, office.timezone, charted);
  const max = Math.max(10, ...history.flat(), ...thresholds.slice(0, charted.length));
  const chartMax = Math.ceil(max / 10) * 10;

  return {
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
        image: await toPngDataUrl(await itemImage(i.imageKey, i.terminalImage)),
        pattern: await toPngDataUrl(patternSample(index, 8)),
      })),
    ),
    chart:
      charted.length > 0
        ? {
            image: await toPngDataUrl(stockChart(history, chartMax, Math.min(...thresholds), CHART_WIDTH, CHART_HEIGHT)),
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
          image: await toPngDataUrl(await itemImage(i.imageKey, i.terminalImage)),
        })),
      ),
    },
    lowLabel: t("lowStock"),
    moreLabel: t("more"),
    chartLabel: t("chart", { days: CHART_DAYS }),
    leftLabel: labels.left,
    rightLabel: labels.right,
  };
}
