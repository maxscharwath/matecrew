import { prisma } from "@/lib/prisma";
import { requireMembership } from "@/lib/auth-utils";
import { resolveAvatarUrl } from "@/lib/storage";
import { getTodayDate, getDayOfWeek, toISODateString } from "@/lib/date";
import { getActiveSession, getMostRecentSession, isSessionOpen } from "@/lib/session-utils";
import { getForgottenOrders } from "@/lib/forgotten-orders";
import { RunnerView } from "@/components/runner-view";

interface Props {
  readonly params: Promise<{ officeId: string }>;
  readonly searchParams: Promise<{ date?: string; session?: string }>;
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
  ));
}

type NavTarget = { date: string; session: string };

/**
 * Walk through the weekly schedule by `step` days (negative = backwards)
 * and return the first session found, paired with the resulting date.
 * `pickSession`: "last" for prev navigation, "first" for next.
 */
function findAdjacentDaySession(
  allSessions: { id: string; dayOfWeek: number; startTime: string }[],
  baseDate: Date,
  baseDow: number,
  step: number,
  pickSession: "first" | "last",
): NavTarget | null {
  const sort = pickSession === "last"
    ? (a: { startTime: string }, b: { startTime: string }) => b.startTime.localeCompare(a.startTime)
    : (a: { startTime: string }, b: { startTime: string }) => a.startTime.localeCompare(b.startTime);

  for (let offset = 1; offset <= 7; offset++) {
    const dow = (baseDow + step * offset + 7) % 7;
    const sessions = allSessions.filter((s) => s.dayOfWeek === dow).sort(sort);
    if (sessions.length > 0) {
      return { date: toISODateString(addDays(baseDate, step * offset)), session: sessions[0].id };
    }
  }
  return null;
}

/**
 * Compute the previous and next session relative to (date, sessionId).
 * Navigation wraps across days/weeks; next is clamped to today.
 */
function computeSessionNav(
  allSessions: { id: string; dayOfWeek: number; startTime: string }[],
  currentDate: Date,
  currentSessionId: string,
  today: Date,
): { prev: NavTarget | null; next: NavTarget | null } {
  const currentDow = currentDate.getUTCDay();
  const currentSession = allSessions.find((s) => s.id === currentSessionId);
  if (!currentSession) return { prev: null, next: null };

  // PREV: same-day earlier session, or walk backwards across days
  const sameDayEarlier = allSessions
    .filter((s) => s.dayOfWeek === currentDow && s.startTime < currentSession.startTime)
    .sort((a, b) => b.startTime.localeCompare(a.startTime));

  const prev = sameDayEarlier.length > 0
    ? { date: toISODateString(currentDate), session: sameDayEarlier[0].id }
    : findAdjacentDaySession(allSessions, currentDate, currentDow, -1, "last");

  // NEXT: same-day later session, or walk forwards across days (clamped to today)
  const sameDayLater = allSessions
    .filter((s) => s.dayOfWeek === currentDow && s.startTime > currentSession.startTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  let next: NavTarget | null = sameDayLater.length > 0
    ? { date: toISODateString(currentDate), session: sameDayLater[0].id }
    : findAdjacentDaySession(allSessions, currentDate, currentDow, 1, "first");

  // Don't navigate past today
  if (next && next.date > toISODateString(today)) {
    next = null;
  }

  return { prev, next };
}

type SessionRow = { id: string; dayOfWeek: number; startTime: string; cutoffTime: string; label: string | null };

async function resolveDefaultSession(
  daySessions: SessionRow[],
  officeId: string,
  timezone: string,
  isToday: boolean,
): Promise<SessionRow | undefined> {
  if (isToday) {
    const active = await getActiveSession(officeId, timezone);
    const mostRecent = active ?? await getMostRecentSession(officeId, timezone);
    if (mostRecent) return daySessions.find((s) => s.id === mostRecent.id) ?? daySessions[0];
  }
  return daySessions[0];
}

export default async function RunnerPage({ params, searchParams }: Props) {
  const { officeId } = await params;
  const { date: dateParam, session: sessionParam } = await searchParams;
  await requireMembership(officeId);

  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
    select: { timezone: true, lowStockThreshold: true },
  });

  const stock = await prisma.stock.findUnique({
    where: { officeId },
    select: { currentQty: true },
  });

  const today = getTodayDate();
  const selectedDate = parseDate(dateParam) ?? today;
  const date = new Date(Math.min(selectedDate.getTime(), today.getTime()));
  const isToday = toISODateString(date) === toISODateString(today);

  // Get all sessions for this office (for navigation across days)
  const allSessions = await prisma.mateSession.findMany({
    where: { officeId },
    select: { id: true, dayOfWeek: true, startTime: true, cutoffTime: true, label: true },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });

  // Get sessions for the selected date's day of week
  const dayOfWeek = isToday ? getDayOfWeek(office.timezone) : date.getUTCDay();
  const daySessions = allSessions.filter((s) => s.dayOfWeek === dayOfWeek);

  // Determine current session
  const currentSession = sessionParam
    ? daySessions.find((s) => s.id === sessionParam) ?? daySessions[0]
    : await resolveDefaultSession(daySessions, officeId, office.timezone, isToday);

  // Compute prev/next session navigation
  const nav = currentSession
    ? computeSessionNav(allSessions, date, currentSession.id, today)
    : { prev: null, next: null };

  // Fetch requests filtered by date (and session if available)
  const requests = await prisma.dailyRequest.findMany({
    where: {
      date,
      officeId,
      ...(currentSession ? { mateSessionId: currentSession.id } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  const resolvedRequests = await Promise.all(
    requests.map(async (r) => ({
      ...r,
      user: {
        ...r.user,
        image: resolveAvatarUrl(r.user.image),
      },
    })),
  );

  const sessionInfo = currentSession
    ? {
        id: currentSession.id,
        label: currentSession.label,
        startTime: currentSession.startTime,
        cutoffTime: currentSession.cutoffTime,
        isOpen: isToday ? isSessionOpen(currentSession, office.timezone) : false,
      }
    : null;

  // Compute "current session" href for the quick-jump button when viewing past sessions
  let currentSessionHref: string | null = null;
  if (!isToday) {
    const active = await getActiveSession(officeId, office.timezone);
    const liveSession = active ?? await getMostRecentSession(officeId, office.timezone);
    if (liveSession) {
      currentSessionHref = `?date=${toISODateString(today)}&session=${liveSession.id}`;
    }
  }

  const forgottenOrders = await getForgottenOrders(officeId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <RunnerView
        requests={resolvedRequests}
        date={date}
        officeId={officeId}
        session={sessionInfo}
        isToday={isToday}
        prevHref={nav.prev ? `?date=${nav.prev.date}&session=${nav.prev.session}` : null}
        nextHref={nav.next ? `?date=${nav.next.date}&session=${nav.next.session}` : null}
        currentSessionHref={currentSessionHref}
        stockQty={stock?.currentQty ?? 0}
        lowStockThreshold={office.lowStockThreshold}
        forgottenOrders={forgottenOrders}
      />
    </div>
  );
}
