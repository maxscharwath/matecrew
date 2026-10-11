import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { platform } from "@/platform";
import { requireOrgRoles } from "@/lib/auth-utils";
import { ITEM_DISPLAY_ORDER } from "@/lib/items";
import { loadLiveStatus } from "@/lib/device/live";
import { defaultDeviceTheme } from "@/lib/device/state";
import { DeviceConsole } from "@/components/device-console/device-console";

interface Props {
  readonly params: Promise<{ officeId: string; deviceId: string }>;
}

/** Takes listed in the activity tab. */
const RECENT_TAKES = 30;

export default async function DevicePage({ params }: Props) {
  const { officeId, deviceId } = await params;
  const { session } = await requireOrgRoles(officeId, "ADMIN");

  const device = await prisma.device.findFirst({
    where: { id: deviceId, officeId },
    select: {
      id: true,
      name: true,
      hardwareId: true,
      leftItemId: true,
      locale: true,
      theme: true,
      openFrom: true,
      openUntil: true,
      openDays: true,
      sounds: true,
      office: { select: { timezone: true, locale: true } },
    },
  });
  if (!device) notFound();

  const [badges, items, takes, live, relay] = await Promise.all([
    prisma.badge.findMany({
      where: { officeId },
      orderBy: [{ user: { name: "asc" } }, { lastSeenAt: "desc" }],
      select: { uid: true, user: { select: { name: true } } },
    }),
    prisma.item.findMany({ where: { officeId, active: true }, orderBy: ITEM_DISPLAY_ORDER, select: { id: true, name: true } }),
    prisma.deviceTake.findMany({
      where: { deviceId },
      orderBy: { takenAt: "desc" },
      take: RECENT_TAKES,
      select: { id: true, badgeUid: true, itemId: true, rejectedReason: true, takenAt: true },
    }),
    // Without a relay, also marks the console open: the terminal starts mirroring its screen.
    loadLiveStatus(device.id),
    // With one, the console's socket: everything else is pushed on it.
    platform.relay.console(device.id, session.user.id),
  ]);
  const holder = new Map(badges.map((b) => [b.uid, b.user?.name ?? null]));

  return (
    <div className="mx-auto max-w-7xl">
      <DeviceConsole
        officeId={officeId}
        device={{
          id: device.id,
          name: device.name,
          hardwareId: device.hardwareId,
          firstItemId: device.leftItemId,
          locale: device.locale,
          theme: device.theme,
          openFrom: device.openFrom,
          openUntil: device.openUntil,
          openDays: device.openDays,
          sounds: device.sounds,
        }}
        display={{ officeLocale: device.office.locale, defaultTheme: defaultDeviceTheme() }}
        items={items}
        badges={badges.map((b) => ({ uid: b.uid, name: b.user?.name ?? null }))}
        takes={takes.map((take) => ({
          id: take.id,
          who: holder.get(take.badgeUid) ?? take.badgeUid,
          item: items.find((i) => i.id === take.itemId)?.name ?? null,
          rejectedReason: take.rejectedReason,
          takenAt: take.takenAt.toISOString(),
        }))}
        initial={live}
        relay={relay}
        renderedAt={new Date().toISOString()}
        timeZone={device.office.timezone}
      />
    </div>
  );
}
