import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { platform } from "@/platform";
import { effectiveLowStockThreshold } from "@/lib/stock";
import { getCurrentTimeInTimezone, getDateInTimezone, getDayOfWeek, getTodayDate, timeToMinutes } from "@/lib/date";
import { getSessionsForDay } from "@/lib/session-utils";
import { itemImage, withOpacity } from "@/lib/device/bitmap";
import { AVATAR_SIDE, avatarPicture, initials } from "@/lib/device/avatar";
import type { AuthenticatedDevice } from "@/lib/device/auth";
import { deviceTheme, type DeviceState, type DeviceScreen, type DeviceTheme } from "@/lib/device/contract";
import { parseSyncTimes } from "@/lib/device/sync-times";
import { hoursAt, parseDays, wakeWords } from "@/lib/device/hours";
import { parseSounds } from "@/lib/device/sounds";
import { deviceClock, deviceTimeZone, formatTime, timeFormatOf } from "@/lib/device/clock";

/** The theme of terminals that have none of their own: `DEVICE_UI_THEME`, else paper. */
export function defaultDeviceTheme(): DeviceTheme {
  return deviceTheme.catch("paper").parse(platform.env.get("DEVICE_UI_THEME") ?? "paper");
}

/** Below this the terminal and the site warn that it needs charging. */
export const LOW_BATTERY_MV = 3500;
/** After a session's cutoff, the terminal shows what to prepare for this long, or until it is served. */
export const PREPARATION_MINUTES = 90;
/** People shown on an order's card of the preparation, with their avatar; the others are counted. */
const PREPARATION_PEOPLE = 5;

/** Interim app download until per-device apps: `DEVICE_UI_APP` names one of `device/dist/*.dui`. */
const DOWNLOADABLE_APPS = ["hello", "showcase"] as const;
export function downloadableApp(): (typeof DOWNLOADABLE_APPS)[number] | null {
  const app = platform.env.get("DEVICE_UI_APP");
  return DOWNLOADABLE_APPS.find((name) => name === app) ?? null;
}
/** Days of stock on the main screen's chart, today included. */
const CHART_DAYS = 14;
/** Items with their own line on the chart: as many as the main screen shows. */
const CHART_MAX_ITEMS = 6;
/** Days of consumption, today included, that order each member's picker. */
const FAVOURITE_DAYS = 30;
const DAY_MS = 86_400_000;

function wifiBars(rssi: number | null): number | null {
  if (rssi == null) return null;
  if (rssi > -60) return 3;
  if (rssi > -70) return 2;
  if (rssi > -80) return 1;
  return 0;
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
      terminalImage: true,
      terminalPhoto: true,
      lowStockThreshold: true,
      stock: { where: { officeId }, select: { currentQty: true } },
    },
  });
  return items.map((i) => ({ ...i, qty: i.stock[0]?.currentQty ?? 0 }));
}

/** Left key takes (with a choice of item), right key opens the person's account ("Mon compte"). */
async function keyLabels(device: AuthenticatedDevice) {
  const t = await getTranslations({ locale: device.office.locale, namespace: "devices.keys" });
  return { left: t("take"), right: t("summary") };
}

/** Base64 of the packed bits, which device/core decodes. */
function base64(bits: Uint8Array): string {
  return Buffer.from(bits).toString("base64");
}

export async function buildDeviceState(device: AuthenticatedDevice): Promise<DeviceState> {
  const { office } = device;
  const [items, badges, labels, favourites] = await Promise.all([
    loadItems(office.id),
    prisma.badge.findMany({
      where: { officeId: office.id, userId: { not: null } },
      select: { uid: true, userId: true, user: { select: { name: true } } },
    }),
    keyLabels(device),
    favouriteItems(office.id, office.timezone),
  ]);
  const release = await prisma.firmwareRelease.findFirst({ orderBy: { createdAt: "desc" } });
  const relayUrl = platform.relay.terminalUrl();
  // The picker opens on the left key's item; the rest follow in shelf order.
  const first = items.findIndex((i) => i.id === device.leftItemId);
  const ordered = first > 0 ? [items[first], ...items.filter((_, i) => i !== first)] : items;

  return {
    device: { id: device.id, name: device.name },
    office: { name: office.name, timezone: office.timezone, locale: office.locale },
    keys: { left: { label: labels.left }, right: { label: labels.right } },
    items: ordered.map((i) => ({
      id: i.id,
      name: i.name,
      stock: i.qty,
      picture: base64(withOpacity(itemImage(i.terminalImage, i.terminalPhoto))),
    })),
    // Names only: what each one drank stays on the site (`/api/device/account`).
    badges: badges.map((b) => ({ uid: b.uid, name: b.user?.name ?? "", items: (b.userId && favourites.get(b.userId)) || [] })),
    syncTimes: await syncTimes(office.id, office.timezone, parseSyncTimes(device.syncTimes)),
    serverTime: new Date().toISOString(),
    screen: await buildScreenData(device, { items, labels }),
    appUrl: downloadableApp() ? "/api/device/ui" : null,
    // Its own, set in its console's settings, else the site's default.
    theme: deviceTheme.catch(defaultDeviceTheme()).parse(device.theme ?? defaultDeviceTheme()),
    firmware: release && {
      version: release.version,
      url: `/api/device/firmware/${encodeURIComponent(release.version)}`,
      sha256: release.sha256,
      size: release.size,
    },
    realtime: relayUrl ? { url: relayUrl } : null,
    refreshAt: await refreshAt(office.id, office.timezone),
    hours: officeHours(device),
    sounds: parseSounds(device.sounds),
    clock: deviceClock(device),
  };
}

/**
 * Per member, the ids of the items they drank over the last FAVOURITE_DAYS days (cancelled takes
 * left out), most first; a tie goes to the one drunk last. The terminal's picker shows them first.
 */
async function favouriteItems(officeId: string, timezone: string): Promise<Map<string, string[]>> {
  const today = getDateInTimezone(new Date(), timezone);
  const totals = await prisma.consumptionEntry.groupBy({
    by: ["userId", "itemId"],
    where: { officeId, cancelledAt: null, date: { gt: new Date(today.getTime() - FAVOURITE_DAYS * DAY_MS) } },
    _sum: { qty: true },
    _max: { date: true },
  });
  const byUser = new Map<string, typeof totals>();
  for (const total of totals) byUser.set(total.userId, [...(byUser.get(total.userId) ?? []), total]);
  return new Map(
    [...byUser].map(([userId, own]) => [
      userId,
      own
        .filter((t) => (t._sum.qty ?? 0) > 0)
        .sort((a, b) => (b._sum.qty ?? 0) - (a._sum.qty ?? 0) || (b._max.date?.getTime() ?? 0) - (a._max.date?.getTime() ?? 0))
        .map((t) => t.itemId),
    ]),
  );
}

/** Its office hours now, in its time zone; closed, when its night screen says it wakes up. */
function officeHours(device: AuthenticatedDevice): DeviceState["hours"] {
  const { locale } = device.office;
  const timezone = deviceTimeZone(device);
  const now = new Date();
  const hours = hoursAt({ from: device.openFrom, until: device.openUntil, days: parseDays(device.openDays) }, timezone, now);
  const { day, time, weekday } = wakeWords(hours.until, timezone, locale, now, timeFormatOf(device));
  return { open: hours.open, until: hours.until.toISOString(), weekend: hours.weekend, day, time, weekday };
}

/**
 * The next time today this state changes by itself: a session's cutoff (its preparation shows)
 * or a preparation's end. Nothing is written then, so nothing tells the terminal: it syncs at
 * this time on its own, a second after the minute turns.
 */
async function refreshAt(officeId: string, timezone: string, now = new Date()): Promise<string | null> {
  const minutes = timeToMinutes(getCurrentTimeInTimezone(timezone));
  const sessions = await getSessionsForDay(officeId, getDayOfWeek(timezone));
  const next = sessions
    .flatMap((s) => [timeToMinutes(s.cutoffTime), timeToMinutes(s.cutoffTime) + PREPARATION_MINUTES])
    .filter((m) => m > minutes && m < 24 * 60)
    .sort((a, b) => a - b)[0];
  if (next === undefined) return null;
  const minuteStart = now.getTime() - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
  return new Date(minuteStart + (next - minutes) * 60_000 + 1_000).toISOString();
}

/** The device's own times plus today's cutoffs, so it wakes up for each preparation. */
async function syncTimes(officeId: string, timezone: string, own: string[]): Promise<string[]> {
  const sessions = await getSessionsForDay(officeId, getDayOfWeek(timezone));
  // "HH:MM" in code-unit order, as `sort()` without a compare function gave.
  return [...new Set([...own, ...sessions.map((s) => s.cutoffTime)])].sort((a, b) => Number(a > b) - Number(a < b));
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
  const session = sessions.findLast(
    (s) => now >= timeToMinutes(s.cutoffTime) && now < timeToMinutes(s.cutoffTime) + PREPARATION_MINUTES,
  );
  if (!session) return null;
  const requests = await prisma.dailyRequest.findMany({
    where: { officeId, date: getTodayDate(), mateSessionId: session.id, status: "REQUESTED" },
    orderBy: { createdAt: "asc" },
    select: {
      item: { select: { id: true, name: true, terminalImage: true, terminalPhoto: true } },
      user: { select: { id: true, name: true, image: true } },
    },
  });
  if (requests.length === 0) return null;
  type Person = { initials: string; avatar: Promise<string | null> };
  const byItem = new Map<string, { name: string; terminalImage: Uint8Array | null; terminalPhoto: Uint8Array | null; names: string[]; people: Person[] }>();
  // Only the people this preparation concerns, each avatar worked out once.
  const avatars = new Map<string, Promise<string | null>>();
  for (const r of requests) {
    const entry = byItem.get(r.item.id) ?? {
      name: r.item.name,
      terminalImage: r.item.terminalImage,
      terminalPhoto: r.item.terminalPhoto,
      names: [],
      people: [],
    };
    entry.names.push(r.user.name.split(" ")[0]);
    if (entry.people.length < PREPARATION_PEOPLE) {
      if (!avatars.has(r.user.id)) avatars.set(r.user.id, avatarPicture(r.user.id, r.user.image, AVATAR_SIDE.preparation));
      entry.people.push({ initials: initials(r.user.name), avatar: avatars.get(r.user.id)! });
    }
    byItem.set(r.item.id, entry);
  }
  const items = await Promise.all(
    [...byItem.values()].map(async (item) => ({
      ...item,
      people: await Promise.all(item.people.map(async (p) => ({ initials: p.initials, avatar: await p.avatar }))),
    })),
  );
  return { sessionId: session.id, label: session.label, total: requests.length, items };
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
  // Always "HH:MM": firmware before 0.5 reads its clock from it (an English locale's "02:05 PM"
  // left it at "--:--"); newer ones read `clock`.
  const time = formatTime(new Date(), deviceTimeZone(device), "24");

  const thresholds = items.map((i) => effectiveLowStockThreshold(i.lowStockThreshold, office.lowStockThreshold));
  // One line per item the main screen shows, each on its tile; the rest are only counted.
  const shown = items.slice(0, CHART_MAX_ITEMS);
  const history = shown.length ? await stockHistory(office.id, office.timezone, shown) : [];
  const max = Math.max(10, ...history.flat());
  const chartMax = Math.ceil(max / 10) * 10;

  return {
    officeName: office.name,
    time,
    wifiBars: wifiBars(device.wifiRssi),
    batteryPercent: batteryPercent(device.batteryMv),
    batteryLowLabel: device.batteryMv != null && device.batteryMv < LOW_BATTERY_MV ? t("batteryLow") : null,
    items: items.map((i, index) => ({
      name: i.name,
      stock: i.qty,
      low: i.qty <= thresholds[index],
      picture: base64(withOpacity(itemImage(i.terminalImage, i.terminalPhoto))),
    })),
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
      items: prep.items.map((i) => ({
        name: i.name,
        count: i.names.length,
        names: i.names.join(", "),
        picture: base64(withOpacity(itemImage(i.terminalImage, i.terminalPhoto))),
        people: i.people,
      })),
      sessionId: prep.sessionId,
      serveLabel: t("serve"),
    },
    lowLabel: t("lowStock"),
    moreLabel: t("more"),
    chartLabel: t("chart", { days: CHART_DAYS }),
    leftLabel: labels.left,
    rightLabel: labels.right,
  };
}
