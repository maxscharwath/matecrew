import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { resolveAvatarUrl } from "@/lib/storage";
import { getTodayDate, getDayOfWeek } from "@/lib/date";
import { getSessionsForDay, getActiveSession, getMostRecentSession, isSessionOpen } from "@/lib/session-utils";
import { RunnerView } from "@/components/runner-view";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function RunnerPage({ params }: Props) {
  const { officeId } = await params;
  await requireMembership(officeId);

  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
    select: { timezone: true },
  });

  const today = getTodayDate();
  const dayOfWeek = getDayOfWeek(office.timezone);

  const [requests, todaySessions] = await Promise.all([
    prisma.dailyRequest.findMany({
      where: { date: today, officeId },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    }),
    getSessionsForDay(officeId, dayOfWeek),
  ]);

  // Determine which session to show by default
  const active = await getActiveSession(officeId, office.timezone);
  const mostRecent = active ?? await getMostRecentSession(officeId, office.timezone);
  const currentSessionId = mostRecent?.id ?? todaySessions[0]?.id ?? null;

  const sessionTabs = todaySessions.map((s) => ({
    id: s.id,
    label: s.label,
    startTime: s.startTime,
    cutoffTime: s.cutoffTime,
    isOpen: isSessionOpen(s, office.timezone),
  }));

  const resolvedRequests = await Promise.all(
    requests.map(async (r) => ({
      ...r,
      user: {
        ...r.user,
        image: resolveAvatarUrl(r.user.image),
      },
    })),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <RunnerView
        requests={resolvedRequests}
        date={today}
        officeId={officeId}
        todaySessions={sessionTabs}
        currentSessionId={currentSessionId}
      />
    </div>
  );
}
