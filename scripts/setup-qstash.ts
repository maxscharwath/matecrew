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
 * Creates the static schedules from cron-schedules.json (recreating any whose
 * cron string changed) and then bootstraps dynamic per-session schedules from
 * the DB via syncSessionSchedules.
 */

import { syncSessionSchedules } from "../src/lib/schedule-sync";

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
      if (match.cron === cron) {
        console.log(`  Already up to date (ID: ${match.scheduleId}, cron: ${match.cron})`);
        return;
      }
      console.log(`  Cron changed (${match.cron} -> ${cron}), recreating schedule...`);
      const delRes = await fetch(`https://qstash.upstash.io/v2/schedules/${match.scheduleId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${QSTASH_TOKEN}` },
      });
      if (!delRes.ok) {
        const text = await delRes.text();
        console.error(`  Failed to delete old schedule: ${delRes.status} ${text}`);
        return;
      }
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

  console.log("\nSyncing dynamic session schedules from DB...");
  try {
    const r = await syncSessionSchedules();
    console.log(
      `  Created: ${r.created}, Deleted: ${r.deleted}, Kept: ${r.kept}`,
    );
    if (r.desired.length === 0) {
      console.log("  (No offices with Slack channels configured yet.)");
    } else {
      for (const cron of r.desired) console.log(`  - ${cron}`);
    }
  } catch (e) {
    console.error("  Failed:", e instanceof Error ? e.message : e);
  }

  console.log("\nDone! Manage at: https://console.upstash.com/qstash");
}

main();
