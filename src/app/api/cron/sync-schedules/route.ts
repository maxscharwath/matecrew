import { verifyQStashSignature } from "@/lib/qstash";
import { syncSessionSchedules } from "@/lib/schedule-sync";

/**
 * Weekly cron handler — recomputes QStash session-notification schedules from
 * the DB. Catches DST drift and any divergence from server-action sync calls.
 */
export async function POST(request: Request) {
  if (!(await verifyQStashSignature(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncSessionSchedules();
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
