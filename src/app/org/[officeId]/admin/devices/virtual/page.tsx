import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { VirtualDevicePanel } from "@/components/device-console/virtual-device";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function VirtualDevicePage({ params }: Props) {
  const { officeId } = await params;
  const { membership } = await requireOrgRoles(officeId, "ADMIN");
  const badges = await prisma.badge.findMany({
    where: { officeId },
    orderBy: [{ user: { name: "asc" } }, { lastSeenAt: "desc" }],
    select: { uid: true, user: { select: { name: true } } },
  });

  return (
    <div className="mx-auto max-w-6xl">
      <VirtualDevicePanel
        officeId={officeId}
        officeName={membership.office.name}
        badges={badges.map((b) => ({ uid: b.uid, name: b.user?.name ?? null }))}
      />
    </div>
  );
}
