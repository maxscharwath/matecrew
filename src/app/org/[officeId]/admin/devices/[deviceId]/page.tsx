import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { loadLiveStatus } from "@/lib/device/live";
import { DeviceConsole } from "@/components/device-console/device-console";

interface Props {
  readonly params: Promise<{ officeId: string; deviceId: string }>;
}

export default async function DeviceConsolePage({ params }: Props) {
  const { officeId, deviceId } = await params;
  await requireOrgRoles(officeId, "ADMIN");

  const device = await prisma.device.findFirst({
    where: { id: deviceId, officeId },
    select: { id: true, name: true, hardwareId: true },
  });
  if (!device) notFound();

  const [badges, live] = await Promise.all([
    prisma.badge.findMany({
      where: { officeId },
      orderBy: [{ user: { name: "asc" } }, { lastSeenAt: "desc" }],
      select: { uid: true, user: { select: { name: true } } },
    }),
    loadLiveStatus(device.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <DeviceConsole
        officeId={officeId}
        device={device}
        badges={badges.map((b) => ({ uid: b.uid, name: b.user?.name ?? null }))}
        initial={live}
        renderedAt={new Date().toISOString()}
      />
    </div>
  );
}
