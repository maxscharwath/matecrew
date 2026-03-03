/**
 * Setup QStash schedules for MateCrew cron jobs.
 *
 * Usage:
 *   bun scripts/setup-qstash.ts
 *
 * Required env vars (in .env.local):
 *   QSTASH_TOKEN
 *   NEXT_PUBLIC_APP_URL  (your deployed URL, e.g. https://matecrew.vercel.app)
 *
 * Creates two schedules:
 *   1. Session notifications — every 5 min, 24/7 (288 msg/day, within free tier)
 *   2. Monthly reimbursements — 1st of each month at 02:00 UTC
 */

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

if (!QSTASH_TOKEN) {
  console.error("Missing QSTASH_TOKEN in environment");
  process.exit(1);
}

if (!APP_URL) {
  console.error("Missing NEXT_PUBLIC_APP_URL in environment");
  process.exit(1);
}

import cronSchedules from "../cron-schedules.json";

const schedules = cronSchedules.map((s) => ({
  name: s.name,
  destination: `${APP_URL}${s.path}`,
  cron: s.cron,
}));

async function createSchedule(name: string, destination: string, cron: string) {
  console.log(`\n${name}`);
  console.log(`  Destination: ${destination}`);
  console.log(`  Cron: ${cron}`);

  // Check for existing schedule
  const listRes = await fetch("https://qstash.upstash.io/v2/schedules", {
    headers: { Authorization: `Bearer ${QSTASH_TOKEN}` },
  });

  if (listRes.ok) {
    const existing = (await listRes.json() as { destination: string; scheduleId: string; cron: string }[]);
    const match = existing.find((s) => s.destination === destination);
    if (match) {
      console.log(`  Already exists (ID: ${match.scheduleId}, cron: ${match.cron})`);
      console.log("  To update, delete it first from https://console.upstash.com/qstash");
      return;
    }
  }

  const res = await fetch(`https://qstash.upstash.io/v2/schedules/${destination}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      "Content-Type": "application/json",
      "Upstash-Cron": cron,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`  Failed: ${res.status} ${text}`);
    return;
  }

  const data = await res.json() as { scheduleId: string };
  console.log(`  Created! ID: ${data.scheduleId}`);
}

async function main() {
  console.log("Setting up QStash schedules...");

  for (const s of schedules) {
    await createSchedule(s.name, s.destination, s.cron);
  }

  console.log("\nDone! Manage at: https://console.upstash.com/qstash");
}

main();
