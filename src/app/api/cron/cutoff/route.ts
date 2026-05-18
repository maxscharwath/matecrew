import { verifyQStashSignature } from "@/lib/qstash";
import { sendCutoffNotifications } from "@/lib/notifications";

/**
 * Cron handler — triggered by Upstash QStash at every session's cutoffTime.
 * Posts a Slack message naming the requesters and exposing a "mark all served"
 * button so the runner can close the loop without opening the web app.
 */
export async function POST(request: Request) {
  if (!(await verifyQStashSignature(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await sendCutoffNotifications();

  return Response.json({ sent: results.length, results });
}
