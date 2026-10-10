import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import type { CostingLedger } from "@/lib/costing";
import { cancelConsumptionEntry } from "@/lib/cancel-consumption";
import { formatMoney, roundCents } from "@/lib/money";
import { normalizeBadgeUid } from "@/lib/device/codes";
import type { AuthenticatedDevice } from "@/lib/device/auth";
import type { CancelPurchaseResponse, Purchase } from "@/lib/device/contract";

/** Purchases a terminal lists: a few pages of four. */
const PURCHASES = 20;

/** Money for the panel, whose fonts are Latin-1: plain spaces instead of no-break ones. */
export function panelMoney(amount: number, locale: string): string {
  return formatMoney(roundCents(amount), locale).replace(/[  ]/g, " ");
}

/** The member a badge belongs to in the terminal's office, or null. */
export async function badgeHolder(device: AuthenticatedDevice, rawUid: string): Promise<string | null> {
  const uid = normalizeBadgeUid(rawUid);
  if (!uid) return null;
  const badge = await prisma.badge.findUnique({
    where: { officeId_uid: { officeId: device.officeId, uid } },
    select: { userId: true },
  });
  return badge?.userId ?? null;
}

/**
 * The member's latest purchases the site still counts, newest first, worded for the panel. Prices
 * come from `ledger`; without it the list stands without them.
 */
export async function latestPurchases(
  device: AuthenticatedDevice,
  userId: string,
  ledger: CostingLedger | null,
): Promise<Purchase[]> {
  const { office } = device;
  const [entries, t] = await Promise.all([
    prisma.consumptionEntry.findMany({
      where: { officeId: office.id, userId, cancelledAt: null },
      orderBy: { createdAt: "desc" },
      take: PURCHASES,
      select: { id: true, itemId: true, createdAt: true, item: { select: { name: true } } },
    }),
    getTranslations({ locale: office.locale, namespace: "devices.screen" }),
  ]);
  const costs = new Map<string, number>();
  for (const draw of ledger?.draws ?? []) {
    if (draw.kind === "CONSUMPTION") costs.set(draw.sourceId, (costs.get(draw.sourceId) ?? 0) + draw.cost);
  }
  const zone = { timeZone: office.timezone };
  // Days compared as the office sees them.
  const day = new Intl.DateTimeFormat("en-CA", { ...zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const clock = new Intl.DateTimeFormat(office.locale, { ...zone, hour: "2-digit", minute: "2-digit" });
  const date = new Intl.DateTimeFormat(office.locale, { ...zone, weekday: "short", day: "numeric", month: "short" });
  const today = day.format(new Date());
  const yesterday = day.format(new Date(Date.now() - 86_400_000));
  // The panel's fonts have no narrow no-break space.
  const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

  /** "Aujourd'hui · 14:05", "Hier · 09:12", or the date for older ones. */
  const when = (at: Date) => {
    const time = plain(clock.format(at));
    const on = day.format(at);
    if (on === today) return t("purchaseToday", { time });
    if (on === yesterday) return t("purchaseYesterday", { time });
    return t("purchaseOn", { date: plain(date.format(at)), time });
  };

  return entries.map((entry) => {
    const cost = costs.get(entry.id);
    return {
      id: entry.id,
      itemId: entry.itemId,
      item: entry.item.name,
      when: when(entry.createdAt),
      price: cost === undefined ? null : panelMoney(cost, office.locale),
    };
  });
}

/** Cancels a purchase for its badge holder, by the site's rules; cancelling twice is cancelled. */
export async function cancelPurchase(
  device: AuthenticatedDevice,
  rawUid: string,
  id: string,
): Promise<CancelPurchaseResponse> {
  const userId = await badgeHolder(device, rawUid);
  if (!userId) return { cancelled: false, reason: "unknown_badge" };
  const outcome = await cancelConsumptionEntry({
    officeId: device.officeId,
    userId,
    entryId: id,
    note: `Terminal ${device.name}`,
  });
  if (outcome === "cancelled") return { cancelled: true, reason: null };
  if (outcome === "already_cancelled") return { cancelled: true, reason: outcome };
  return { cancelled: false, reason: outcome };
}
