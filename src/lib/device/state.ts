import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { effectiveLowStockThreshold } from "@/lib/stock";
import type { DeviceKeyAction } from "@/generated/prisma/client";
import type { AuthenticatedDevice } from "@/lib/device/auth";
import type { DeviceState } from "@/lib/device/contract";
import type { ScreenData } from "@/lib/device/screen";

/** Below this the terminal and the site warn that it needs charging. */
export const LOW_BATTERY_MV = 3500;

type KeySide = { action: DeviceKeyAction; itemId: string | null; label: string | null };

async function loadOfficeData(officeId: string) {
  const [items, badges] = await Promise.all([
    prisma.item.findMany({
      where: { officeId, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        lowStockThreshold: true,
        stock: { where: { officeId }, select: { currentQty: true } },
      },
    }),
    prisma.badge.findMany({
      where: { officeId, userId: { not: null } },
      select: { uid: true, user: { select: { name: true } } },
    }),
  ]);
  return { items, badges };
}

async function keyLabel(side: KeySide, itemName: string | null, locale: string) {
  if (side.label) return side.label;
  const t = await getTranslations({ locale, namespace: "devices.keys" });
  const verb = side.action === "TAKE" ? t("take") : t("return");
  return itemName ? `${verb} · ${itemName}` : verb;
}

function sides(device: AuthenticatedDevice): { left: KeySide; right: KeySide } {
  return {
    left: { action: device.leftAction, itemId: device.leftItemId, label: device.leftLabel },
    right: { action: device.rightAction, itemId: device.rightItemId, label: device.rightLabel },
  };
}

export async function buildDeviceState(device: AuthenticatedDevice): Promise<DeviceState> {
  const { office } = device;
  const { items, badges } = await loadOfficeData(office.id);
  const itemName = (id: string | null) => items.find((i) => i.id === id)?.name ?? null;
  const { left, right } = sides(device);

  return {
    device: { id: device.id, name: device.name },
    office: { name: office.name, timezone: office.timezone, locale: office.locale },
    keys: {
      left: { action: left.action, itemId: left.itemId, label: await keyLabel(left, itemName(left.itemId), office.locale) },
      right: { action: right.action, itemId: right.itemId, label: await keyLabel(right, itemName(right.itemId), office.locale) },
    },
    items: items.map((i) => ({ id: i.id, name: i.name, stock: i.stock[0]?.currentQty ?? 0 })),
    badges: badges.map((b) => ({ uid: b.uid, name: b.user?.name ?? "" })),
    syncTimes: device.syncTimes,
    serverTime: new Date().toISOString(),
  };
}

export async function buildScreenData(device: AuthenticatedDevice): Promise<ScreenData> {
  const { office } = device;
  const { items } = await loadOfficeData(office.id);
  const t = await getTranslations({ locale: office.locale, namespace: "devices.screen" });
  const itemName = (id: string | null) => items.find((i) => i.id === id)?.name ?? null;
  const { left, right } = sides(device);
  const time = new Intl.DateTimeFormat(office.locale, {
    timeZone: office.timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  return {
    officeName: office.name,
    updatedLabel: t("updated", { time }),
    batteryLowLabel:
      device.batteryMv != null && device.batteryMv < LOW_BATTERY_MV ? t("batteryLow") : null,
    items: items.map((i) => {
      const stock = i.stock[0]?.currentQty ?? 0;
      const low = stock <= effectiveLowStockThreshold(i.lowStockThreshold, office.lowStockThreshold);
      return { name: i.name, stock, caption: low ? t("lowStock") : t("inStock"), low };
    }),
    leftLabel: await keyLabel(left, itemName(left.itemId), office.locale),
    rightLabel: await keyLabel(right, itemName(right.itemId), office.locale),
  };
}
