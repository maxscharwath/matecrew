import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { getTodayDate } from "@/lib/date";
import { getActiveSession, getNextSession, isSessionOpen } from "@/lib/session-utils";
import { RequestView } from "@/components/request-view";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function RequestPage({ params }: Props) {
  const { officeId } = await params;
  const { session, membership } = await requireMembership(officeId);
  const t = await getTranslations();

  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
    select: { timezone: true },
  });

  const date = getTodayDate();
  const activeSession = await getActiveSession(officeId, office.timezone);
  const mateSessionId = activeSession?.id ?? null;

  const [existingRequest, todayRequests] = await Promise.all([
    prisma.dailyRequest.findFirst({
      where: {
        date,
        officeId,
        userId: session.user.id,
        mateSessionId,
      },
      select: { id: true, officeId: true, status: true },
    }),
    prisma.dailyRequest.findMany({
      where: { date, officeId, mateSessionId },
      select: {
        id: true,
        status: true,
        user: { select: { id: true, name: true, image: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const otherRequesters = todayRequests
    .filter((r) => r.user.id !== session.user.id)
    .map((r) => ({
      name: r.user.name,
      image: r.user.image,
      status: r.status as "REQUESTED" | "SERVED",
    }));

  const cutoffPassed = activeSession
    ? !isSessionOpen(activeSession, office.timezone)
    : true;

  // Build "next session" label
  let nextSessionLabel: string | null = null;
  if (!activeSession) {
    const next = await getNextSession(officeId, office.timezone);
    if (next) {
      const s = next.session;
      const dayLabel = next.isToday ? t('request.todayLabel') : t(`request.dayLabels.${s.dayOfWeek}`);
      nextSessionLabel = `${s.label ?? ""} ${dayLabel} à ${s.startTime}`.trim();
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <RequestView
        officeId={officeId}
        officeName={membership.office.name}
        date={date}
        existingRequest={existingRequest}
        otherRequesters={otherRequesters}
        cutoffTime={activeSession?.cutoffTime ?? null}
        cutoffPassed={cutoffPassed}
        timezone={office.timezone}
        totalRequested={todayRequests.length}
        activeSession={activeSession}
        nextSessionLabel={nextSessionLabel}
      />
    </div>
  );
}
