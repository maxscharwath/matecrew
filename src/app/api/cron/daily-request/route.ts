import { verifyQStashSignature } from "@/lib/qstash";
import { sendSessionNotifications } from "@/lib/notifications";

/**
 * Cron handler — triggered by Upstash QStash every 5 min.
 * Session start times are enforced to multiples of SCHEDULE_STEP_MINUTES,
 * so the detection window guarantees every session is caught exactly once.
 */
export async function POST(request: Request) {
  if (!(await verifyQStashSignature(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await sendSessionNotifications();

  return Response.json({ sent: results.length, results });
}
