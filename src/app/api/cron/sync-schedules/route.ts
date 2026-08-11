import { verifyQStashSignature } from "@/lib/qstash";
import { syncSessionSchedules } from "@/lib/schedule-sync";
import { pruneExpiredOauthTokens } from "@/lib/mcp/token-cleanup";

/**
 * Weekly cron handler — recomputes QStash session-notification schedules from
 * the DB. Catches DST drift and any divergence from server-action sync calls.
 *
 * Also the weekly housekeeping slot for dead MCP OAuth tokens, which accumulate
 * because the refresh grant inserts rather than rotates.
 */
export async function POST(request: Request) {
  if (!(await verifyQStashSignature(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncSessionSchedules();
    // Best-effort: a failed prune must not fail the schedule sync, which is
    // what actually keeps the daily Slack messages firing.
    const tokens = await pruneExpiredOauthTokens().catch((e) => {
      console.error("[cron/sync-schedules] token prune failed", e);
      return { deleted: 0 };
    });
    return Response.json({ ...result, expiredOauthTokensDeleted: tokens.deleted });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
