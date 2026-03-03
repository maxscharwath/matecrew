import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { getTodayDate } from "@/lib/date";
import { RequestView } from "@/components/request-view";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function RequestPage({ params }: Props) {
  const { officeId } = await params;
  const { session, membership } = await requireMembership(officeId);

  const date = getTodayDate();

  const existingRequest = await prisma.dailyRequest.findUnique({
    where: {
      date_officeId_userId: {
        date,
        officeId,
        userId: session.user.id,
      },
    },
    select: { id: true, officeId: true, status: true },
  });

  return (
    <div className="mx-auto max-w-4xl p-8">
      <RequestView
        officeId={officeId}
        officeName={membership.office.name}
        date={date}
        existingRequest={existingRequest}
      />
    </div>
  );
}
