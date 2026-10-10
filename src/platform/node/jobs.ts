import type { JobQueue } from "../ports/jobs";
import { runInBackground } from "./background";

/**
 * Runs each job in this process as soon as it is enqueued, without waiting
 * for it: no broker to run locally, and the request that enqueued it returns
 * at once as it would with a real queue. A failure is logged, not retried.
 */
export const inProcessJobQueue: JobQueue = {
  async enqueue(job) {
    // Imported on use: the registry depends on business code, which depends
    // on this platform object.
    const run = import("@/jobs").then(({ runJob }) => runJob(job));
    runInBackground(run, `job ${job.name}`);
  },
};
