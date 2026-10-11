import { runWithCloudflareRequestContext } from "#open-next/init";
import openNext from "#open-next/worker";
import { runQueuedJob, runScheduledTasks } from "@/jobs";
import { platform } from "@/platform";
import { handleBridgeRequest } from "./bridge/handler";

/** A failed job waits this long per attempt before the queue redelivers it. */
const RETRY_DELAY_SECONDS = 60;

/**
 * Cron runs and queue batches have no request, but OpenNext sets up its
 * context (`getCloudflareContext`, globals) around one: a stand-in on the
 * app's own origin, so the bindings work exactly as in a request.
 */
function withContext(env: CloudflareEnv, ctx: ExecutionContext, run: () => Promise<void>): Promise<void> {
  return runWithCloudflareRequestContext(new Request(platform.env.baseUrl()), env, ctx, run);
}

/**
 * The Worker: OpenNext serves HTTP, the job registry (src/jobs) does the
 * scheduled and queued work. Nothing here knows what a job or task does.
 * Authenticated platform bridge requests (./bridge, for a deployment outside
 * Cloudflare sharing this data) are served before OpenNext.
 */
export default {
  async fetch(request, env, ctx) {
    return (await handleBridgeRequest(request, env)) ?? openNext.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    // Off while another deployment still sends the notifications (wrangler.jsonc `vars`).
    const enabled: string = env.SCHEDULES_ENABLED;
    if (enabled !== "true") return;
    await withContext(env, ctx, () => runScheduledTasks(controller.cron, new Date(controller.scheduledTime)));
  },

  async queue(batch, env, ctx) {
    await withContext(env, ctx, async () => {
      await Promise.all(
        batch.messages.map(async (message) => {
          try {
            await runQueuedJob(message.body);
            message.ack();
          } catch (error) {
            console.error(`[queue] message ${message.id} failed on attempt ${message.attempts}`, error);
            message.retry({ delaySeconds: RETRY_DELAY_SECONDS * message.attempts });
          }
        }),
      );
    });
  },
} satisfies ExportedHandler<CloudflareEnv>;
