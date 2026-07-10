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
import { computeDesiredSchedules } from "../src/lib/schedule-sync";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function checkQStash() {
  const token = process.env.QSTASH_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  console.log("\n=== QStash schedules vs desired ===");
  console.log("QSTASH_TOKEN set:", !!token, "| NEXT_PUBLIC_APP_URL:", appUrl ?? "(unset)");
  if (!token || !appUrl) {
    console.log("Cannot compare: missing token or app url.");
    return;
  }
  const desired = await computeDesiredSchedules(appUrl);
  const res = await fetch("https://qstash.upstash.io/v2/schedules", {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("QStash list status:", res.status);
  const all = (await res.json()) as Array<{ cron: string; destination: string; scheduleId: string; isPaused?: boolean }>;
  if (!Array.isArray(all)) {
    console.log("Unexpected QStash response:", JSON.stringify(all));
    return;
  }
  const key = (s: { cron: string; destination: string }) => {
    const path = s.destination.replace(appUrl, "");
    return `${path}  ${s.cron}`;
  };
  console.log("\nLIVE QStash schedules:");
  for (const s of all) console.log(`  ${key(s)}${s.isPaused ? "  [PAUSED]" : ""}`);
  console.log("\nDESIRED (from DB):");
  for (const d of desired) console.log(`  ${key(d)}`);

  const live = new Set(all.map((s) => `${s.destination}|${s.cron}`));
  const missing = desired.filter((d) => !live.has(`${d.destination}|${d.cron}`));
  console.log("\nMISSING (desired but NOT in QStash) — these will NEVER fire:");
  if (missing.length === 0) console.log("  (none — all desired schedules exist)");
  for (const m of missing) console.log(`  ❌ ${key(m)}`);
}

async function main() {
  console.log("SLACK_BOT_TOKEN set:", !!process.env.SLACK_BOT_TOKEN);
  const today = getTodayDate();
  console.log("getTodayDate():", today.toISOString());
  console.log("server now:", new Date().toISOString());

  const offices = await prisma.office.findMany({
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

  console.log(`\nTotal offices: ${offices.length}`);
  const withSlack = offices.filter((o) => o.slackChannelId);
  console.log(`Offices with slackChannelId: ${withSlack.length}`);
  if (withSlack.length === 0) {
    console.log("=> sendSessionNotifications returns [] immediately. No office has a Slack channel configured.");
  }

  for (const o of offices) {
    const dow = getDayOfWeek(o.timezone);
    const now = getCurrentTimeInTimezone(o.timezone);
    const nowMin = timeToMinutes(now);
    console.log(
      `\n# ${o.name}  tz=${o.timezone}  channel=${o.slackChannelId ? o.slackChannelId.slice(0, 4) + "…" : "(none)"}  today=${DOW[dow]}(${dow}) localNow=${now}`,
    );
    if (!o.slackChannelId) {
      console.log("  SKIP office: no slackChannelId");
      continue;
    }
    if (o.mateSessions.length === 0) console.log("  (no sessions configured)");
    for (const s of o.mateSessions) {
      const reasons: string[] = [];
      if (s.dayOfWeek !== dow)
        reasons.push(`dow ${DOW[s.dayOfWeek]}(${s.dayOfWeek}) != today ${DOW[dow]}(${dow})`);
      const diff = nowMin - timeToMinutes(s.startTime);
      if (diff < 0 || diff >= SCHEDULE_STEP_MINUTES * 2)
        reasons.push(`time window: diff=${diff}min (need 0..${SCHEDULE_STEP_MINUTES * 2 - 1})`);
      const notifiedToday = s.lastNotifiedDate?.getTime() === today.getTime();
      if (notifiedToday)
        reasons.push(`ALREADY notified today (lastNotifiedDate=${s.lastNotifiedDate?.toISOString()})`);
      console.log(
        `  session ${s.label ?? s.startTime} start=${s.startTime} dow=${DOW[s.dayOfWeek]} lastNotified=${s.lastNotifiedDate?.toISOString() ?? "never"}`,
      );
      console.log(
        reasons.length
          ? `    scheduled cron => SKIPPED: ${reasons.join(" | ")}`
          : `    scheduled cron => WOULD SEND ✅`,
      );
      const manualReasons = reasons.filter((r) => !r.startsWith("time window") && !r.startsWith("dow"));
      // Note: manual admin trigger also filters by dow (office.mateSessions.filter(s.dayOfWeek===dow))
      const manualBlocked = s.dayOfWeek !== dow || notifiedToday;
      console.log(
        `    manual admin trigger (skipTimeWindow) => ${manualBlocked ? "SKIPPED: " + (s.dayOfWeek !== dow ? "wrong day; " : "") + (notifiedToday ? "already notified" : "") : "WOULD SEND ✅"}`,
      );
    }
  }

  await checkQStash();

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
