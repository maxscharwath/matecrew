import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getBaseUrl } from "@/lib/base-url";
import { ITEM_DISPLAY_ORDER } from "@/lib/items";
import { DevicesManager } from "@/components/devices-manager";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function DevicesPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations("devices");

  const [devices, items, badges, members] = await Promise.all([
    prisma.device.findMany({
      where: { officeId },
      orderBy: { createdAt: "asc" },
      include: {
        takes: {
          orderBy: { takenAt: "desc" },
          take: 8,
          select: { id: true, action: true, badgeUid: true, rejectedReason: true, takenAt: true, itemId: true },
        },
      },
    }),
    prisma.item.findMany({
      where: { officeId, active: true },
      orderBy: ITEM_DISPLAY_ORDER,
      select: { id: true, name: true },
    }),
    prisma.badge.findMany({
      where: { officeId },
      orderBy: [{ userId: { sort: "asc", nulls: "first" } }, { lastSeenAt: "desc" }],
      select: { id: true, uid: true, lastSeenAt: true, user: { select: { id: true, name: true } } },
    }),
    prisma.membership.findMany({
      where: { officeId },
      orderBy: { user: { name: "asc" } },
      select: { user: { select: { id: true, name: true } } },
    }),
  ]);

  const nameByUid = new Map(badges.map((b) => [b.uid, b.user?.name ?? null]));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <DevicesManager
        officeId={officeId}
        linkUrl={`${getBaseUrl()}/link`}
        items={items}
        members={members.map((m) => m.user)}
        badges={badges.map((b) => ({
          id: b.id,
          uid: b.uid,
          lastSeenAt: b.lastSeenAt.toISOString(),
          user: b.user,
        }))}
        devices={devices.map((d) => ({
          id: d.id,
          name: d.name,
          hardwareId: d.hardwareId,
          leftAction: d.leftAction,
          leftItemId: d.leftItemId,
          leftLabel: d.leftLabel,
          rightAction: d.rightAction,
          rightItemId: d.rightItemId,
          rightLabel: d.rightLabel,
          syncTimes: d.syncTimes,
          firmwareVersion: d.firmwareVersion,
          batteryMv: d.batteryMv,
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
          takes: d.takes.map((take) => ({
            id: take.id,
            action: take.action,
            who: nameByUid.get(take.badgeUid) ?? take.badgeUid,
            item: items.find((i) => i.id === take.itemId)?.name ?? null,
            rejectedReason: take.rejectedReason,
            takenAt: take.takenAt.toISOString(),
          })),
        }))}
      />
    </div>
  );
}
