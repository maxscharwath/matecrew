import { prisma } from "@/lib/prisma";

export type DesiredSchedule = {
  cron: string;
  destination: string;
};

export type SyncResult = {
  created: number;
  deleted: number;
  kept: number;
  desired: string[];
};

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_BY_NAME: Record<string, number> = Object.fromEntries(
  DOW_NAMES.map((name, idx) => [name, idx]),
);

/**
 * UTC offset (in minutes, positive east of UTC) for `instant` interpreted in
 * `timezone`. Reads the local wallclock via Intl and treats it as if it were
 * UTC; the difference from the actual UTC instant is the offset. Works for
 * any IANA zone including those beyond ±12h (Pacific/Auckland NZDT = +780,
 * Pacific/Apia DST = +840) and fractional offsets (Asia/Kolkata = +330).
 */
function getUtcOffsetMinutes(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const localAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((localAsUtc - instant.getTime()) / 60_000);
}

/**
 * Convert a (timezone, dayOfWeek, HH:mm) tuple into the corresponding UTC
 * (dayOfWeek, hour, minute). Probes upcoming dates for one whose local DOW in
 * `timezone` matches, treats hh:mm on that local date as a naive UTC instant,
 * then subtracts the actual offset for that moment to get the real UTC.
 *
 * Robust for any offset in [-12h, +14h] and DST-on-transition-day, because
 * `getUtcOffsetMinutes` returns the actual offset at the (almost-)target
 * instant rather than an assumed range.
 */
export function localToUtc(
  timezone: string,
  localDow: number,
  hhmm: string,
): { dayOfWeek: number; hour: number; minute: number } {
  const [hh, mm] = hhmm.split(":").map(Number);

  for (let offset = 0; offset < 14; offset++) {
    const probe = new Date();
    probe.setUTCDate(probe.getUTCDate() + offset);

    const localName = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    }).format(probe);
    if (DOW_BY_NAME[localName] !== localDow) continue;

    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(probe);
    const [y, mo, d] = ymd.split("-").map(Number);

    // Naive: pretend the local wallclock is UTC. Then subtract the actual
    // offset for that instant in the tz — handles UTC±14h cleanly.
    const naive = new Date(Date.UTC(y, mo - 1, d, hh, mm));
    const offsetMin = getUtcOffsetMinutes(naive, timezone);
    const utc = new Date(naive.getTime() - offsetMin * 60_000);

    return {
      dayOfWeek: utc.getUTCDay(),
      hour: utc.getUTCHours(),
      minute: utc.getUTCMinutes(),
    };
  }

  throw new Error(`No matching DOW in 14 days for ${timezone} dow=${localDow}`);
}

/**
 * Compute the minimal set of QStash cron schedules covering every configured
 * session start. Sessions sharing a UTC (hour, minute) collapse into a single
 * cron with a comma-separated DOW list.
 */
export async function computeDesiredSchedules(
  appUrl: string,
): Promise<DesiredSchedule[]> {
  const offices = await prisma.office.findMany({
    where: { slackChannelId: { not: null } },
    select: {
      timezone: true,
      mateSessions: { select: { dayOfWeek: true, startTime: true } },
    },
  });

  const slots = new Map<string, Set<number>>();
  for (const office of offices) {
    for (const s of office.mateSessions) {
      const utc = localToUtc(office.timezone, s.dayOfWeek, s.startTime);
      const key = `${utc.minute}:${utc.hour}`;
      let dows = slots.get(key);
      if (!dows) {
        dows = new Set();
        slots.set(key, dows);
      }
      dows.add(utc.dayOfWeek);
    }
  }

  const destination = `${appUrl}/api/cron/daily-request`;
  return Array.from(slots.entries()).map(([key, dows]) => {
    const [m, h] = key.split(":").map(Number);
    const dowList = Array.from(dows).sort((a, b) => a - b).join(",");
    return { cron: `${m} ${h} * * ${dowList}`, destination };
  });
}

type QStashSchedule = {
  scheduleId: string;
  destination: string;
  cron: string;
};

/**
 * Reconcile QStash schedules pointing at the daily-request endpoint against
 * the desired set computed from the DB. Idempotent: deletes obsolete crons,
 * creates missing ones, leaves matching ones alone.
 */
export async function syncSessionSchedules(): Promise<SyncResult> {
  const token = process.env.QSTASH_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!token || !appUrl) {
    throw new Error("QSTASH_TOKEN and NEXT_PUBLIC_APP_URL must be set");
  }

  const desired = await computeDesiredSchedules(appUrl);
  const destination = `${appUrl}/api/cron/daily-request`;
  const desiredCrons = new Set(desired.map((s) => s.cron));

  const listRes = await fetch("https://qstash.upstash.io/v2/schedules", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    throw new Error(`QStash list failed: ${listRes.status} ${await listRes.text()}`);
  }
  const all = (await listRes.json()) as QStashSchedule[];
  const ours = all.filter((s) => s.destination === destination);

  let deleted = 0;
  for (const s of ours) {
    if (desiredCrons.has(s.cron)) continue;
    const res = await fetch(
      `https://qstash.upstash.io/v2/schedules/${s.scheduleId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) deleted++;
  }

  const existingCrons = new Set(ours.map((s) => s.cron));
  let created = 0;
  for (const d of desired) {
    if (existingCrons.has(d.cron)) continue;
    const res = await fetch(
      `https://qstash.upstash.io/v2/schedules/${d.destination}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Upstash-Cron": d.cron,
        },
      },
    );
    if (res.ok) created++;
  }

  return {
    created,
    deleted,
    kept: ours.length - deleted,
    desired: desired.map((d) => d.cron).sort(),
  };
}

/**
 * Fire-and-forget wrapper for use inside server actions: never throws and
 * never blocks the action's response. The weekly sync cron is the safety
 * net — DB state is authoritative; QStash is just a cache.
 */
export async function trySyncSessionSchedules(): Promise<void> {
  try {
    const r = await syncSessionSchedules();
    if (r.created || r.deleted) {
      console.log(
        `[schedule-sync] +${r.created} -${r.deleted} (kept ${r.kept})`,
      );
    }
  } catch (e) {
    console.error("[schedule-sync] failed:", e);
  }
}
