import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getTodayDate } from "@/lib/date";
import { RunnerView } from "@/components/runner-view";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function RunnerPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "RUNNER", "ADMIN");

  const today = getTodayDate();

  const requests = await prisma.dailyRequest.findMany({
    where: { date: today, officeId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="mx-auto max-w-4xl p-8">
      <RunnerView requests={requests} date={today} officeId={officeId} />
    </div>
  );
}
