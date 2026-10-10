import { BridgeRoute } from "../cloudflare/bridge/protocol";
import type { JobQueue } from "../ports/jobs";
import type { Bridge } from "./bridge";

/**
 * Sends each job to the Cloudflare deployment's `JOBS` Queue through the
 * platform bridge, so the Worker's queue consumer runs it with its retries
 * and dead-letter queue. Scheduled tasks are not run here at all: only
 * Cloudflare's Cron Triggers fire them, so the shared data sees each run once.
 */
export function bridgeJobQueue(bridge: Bridge): JobQueue {
  return {
    async enqueue(job) {
      await bridge.call(BridgeRoute.jobs, job);
    },
  };
}
