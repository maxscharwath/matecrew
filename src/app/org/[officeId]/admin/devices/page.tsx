import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { platform } from "@/platform";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getBaseUrl } from "@/lib/base-url";
import { withPresence } from "@/lib/device/live";
import { DevicesManager } from "@/components/devices-manager";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function DevicesPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations("devices");

  const [devices, badges, members, takesByBadge] = await Promise.all([
    prisma.device.findMany({
      where: { officeId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        hardwareId: true,
        batteryMv: true,
        wifiRssi: true,
        firmwareVersion: true,
        lastSeenAt: true,
        polledAt: true,
        frame: { select: { hash: true } },
      },
    }),
    prisma.badge.findMany({
      where: { officeId },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, uid: true, firstSeenAt: true, lastSeenAt: true, user: { select: { id: true, name: true } } },
    }),
    prisma.membership.findMany({
      where: { officeId },
      orderBy: { user: { name: "asc" } },
      select: { user: { select: { id: true, name: true } } },
    }),
    prisma.deviceTake.groupBy({
      by: ["badgeUid"],
      where: { device: { officeId }, rejectedReason: null },
      _count: { _all: true },
    }),
  ]);
  const takes = new Map(takesByBadge.map((row) => [row.badgeUid, row._count._all]));
  // Connected now, last report and last screen, from the realtime relay when there is one.
  const presence = await platform.relay.presence(devices.map((d) => d.id));
  const now = new Date();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <DevicesManager
        officeId={officeId}
        linkUrl={`${getBaseUrl()}/link`}
        members={members.map((m) => m.user)}
        badges={badges.map((b) => ({
          id: b.id,
          uid: b.uid,
          firstSeenAt: b.firstSeenAt.toISOString(),
          lastSeenAt: b.lastSeenAt.toISOString(),
          takes: takes.get(b.uid) ?? 0,
          user: b.user,
        }))}
        devices={devices.map((d) => {
          const live = presence?.get(d.id);
          const seen = withPresence(d, live, now);
          return {
            id: d.id,
            name: d.name,
            virtual: d.hardwareId.startsWith("sim-"),
            batteryMv: seen.batteryMv,
            lastSeenAt: seen.lastSeenAt?.toISOString() ?? null,
            online: seen.reachable,
            frameHash: live?.drawnAt ? `r${live.drawnAt}` : (d.frame?.hash ?? null),
          };
        })}
      />
    </div>
  );
}
