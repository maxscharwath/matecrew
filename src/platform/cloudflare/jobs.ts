import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { JobQueue } from "../ports/jobs";

/**
 * Sends each job to the `JOBS` Queue. The Worker's `queue` handler
 * (./worker.ts) consumes it with retries and a dead-letter queue, each batch
 * in its own invocation with its own CPU budget.
 */
export const cloudflareJobQueue: JobQueue = {
  async enqueue(job) {
    await getCloudflareContext().env.JOBS.send(job, { contentType: "json" });
  },
};
