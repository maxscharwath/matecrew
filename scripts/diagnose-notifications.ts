/**
 * Diagnose why the daily-request Slack message is (not) sent.
 *
 * Usage:  bun scripts/diagnose-notifications.ts
 *
 * Prints, per office/session, the exact skip reason used by
 * sendSessionNotifications — WITHOUT printing any secret. Optionally set
 *   SEND=1 bun scripts/diagnose-notifications.ts
 * to actually attempt a post and show the Slack API result.
 */
import { prisma } from "../src/lib/prisma";
import {
  getDayOfWeek,
  getCurrentTimeInTimezone,
  timeToMinutes,
  getTodayDate,
  SCHEDULE_STEP_MINUTES,
} from "../src/lib/date";
import { sendSessionNotifications } from "../src/lib/notifications";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WINDOW_MINUTES = SCHEDULE_STEP_MINUTES * 2;

function loadOffices() {
  return prisma.office.findMany({
    select: {
      id: true,
      name: true,
      slackChannelId: true,
      timezone: true,
      locale: true,
      mateSessions: {
        select: {
          id: true,
          dayOfWeek: true,
          startTime: true,
          cutoffTime: true,
          label: true,
          lastNotifiedDate: true,
        },
        orderBy: { startTime: "asc" },
      },
    },
  });
}

type Office = Awaited<ReturnType<typeof loadOffices>>[number];
type Session = Office["mateSessions"][number];

/** Why the scheduled task would skip this session now, as sendSessionNotifications decides. */
function scheduledSkipReasons(session: Session, dow: number, nowMinutes: number, today: Date): string[] {
  const reasons: string[] = [];
  if (session.dayOfWeek !== dow) {
    reasons.push(`dow ${DOW[session.dayOfWeek]}(${session.dayOfWeek}) != today ${DOW[dow]}(${dow})`);
  }
  const diff = nowMinutes - timeToMinutes(session.startTime);
  if (diff < 0 || diff >= WINDOW_MINUTES) {
    reasons.push(`time window: diff=${diff}min (need 0..${WINDOW_MINUTES - 1})`);
  }
  if (session.lastNotifiedDate?.getTime() === today.getTime()) {
    reasons.push(`ALREADY notified today (lastNotifiedDate=${session.lastNotifiedDate.toISOString()})`);
  }
  return reasons;
}

/** The admin "run now" skips the time window but still filters on the day and on today's notification. */
function manualVerdict(session: Session, dow: number, today: Date): string {
  const reasons: string[] = [];
  if (session.dayOfWeek !== dow) reasons.push("wrong day");
  if (session.lastNotifiedDate?.getTime() === today.getTime()) reasons.push("already notified");
  return reasons.length > 0 ? `SKIPPED: ${reasons.join("; ")}` : "WOULD SEND";
}

function reportSession(session: Session, dow: number, nowMinutes: number, today: Date): void {
  const lastNotified = session.lastNotifiedDate?.toISOString() ?? "never";
  console.log(
    `  session ${session.label ?? session.startTime} start=${session.startTime} dow=${DOW[session.dayOfWeek]} lastNotified=${lastNotified}`,
  );
  const reasons = scheduledSkipReasons(session, dow, nowMinutes, today);
  const scheduled = reasons.length > 0 ? `SKIPPED: ${reasons.join(" | ")}` : "WOULD SEND";
  console.log(`    scheduled task => ${scheduled}`);
  console.log(`    manual admin trigger (skipTimeWindow) => ${manualVerdict(session, dow, today)}`);
}

function reportOffice(office: Office, today: Date): void {
  const dow = getDayOfWeek(office.timezone);
  const now = getCurrentTimeInTimezone(office.timezone);
  const channel = office.slackChannelId ? `${office.slackChannelId.slice(0, 4)}…` : "(none)";
  console.log(`\n# ${office.name}  tz=${office.timezone}  channel=${channel}  today=${DOW[dow]}(${dow}) localNow=${now}`);
  if (!office.slackChannelId) {
    console.log("  SKIP office: no slackChannelId");
    return;
  }
  if (office.mateSessions.length === 0) console.log("  (no sessions configured)");
  for (const session of office.mateSessions) reportSession(session, dow, timeToMinutes(now), today);
}

async function main() {
  console.log("SLACK_BOT_TOKEN set:", !!process.env.SLACK_BOT_TOKEN);
  const today = getTodayDate();
  console.log("getTodayDate():", today.toISOString());
  console.log("server now:", new Date().toISOString());

  const offices = await loadOffices();
  console.log(`\nTotal offices: ${offices.length}`);
  const withSlack = offices.filter((o) => o.slackChannelId);
  console.log(`Offices with slackChannelId: ${withSlack.length}`);
  if (withSlack.length === 0) {
    console.log("=> sendSessionNotifications returns [] immediately. No office has a Slack channel configured.");
  }
  for (const office of offices) reportOffice(office, today);

  if (process.env.SEND === "1") {
    console.log("\n=== SEND=1: attempting real send (skipTimeWindow) for all offices ===");
    const results = await sendSessionNotifications({ skipTimeWindow: true });
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log("\n(Set SEND=1 to actually attempt a post and see the Slack result.)");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
