import { z } from "zod";
import type { Job, JobHandlers, ScheduledTask } from "@/platform";
import { pruneExpiredOauthTokens } from "@/lib/mcp/token-cleanup";
import { closeMonthlyReimbursements } from "@/lib/monthly-reimbursement";
import { sendCutoffNotifications, sendSessionNotifications, type NotificationResult } from "@/lib/notifications";
import { sendPeriodStatements } from "@/lib/settlement-mail";
import { SCHEDULES, type ScheduleName } from "./schedules";

/**
 * The business side of background work: what each job and each scheduled
 * task does. Platform entries (src/platform/cloudflare/worker.ts, a future
 * Azure Functions app) only call `runQueuedJob` and `runScheduledTasks`.
 */

const jobHandlers: JobHandlers = {
  async "period-statements"({ periodId, force }) {
    const result = await sendPeriodStatements(periodId, { force });
    if (result.kind === "sent" && result.failed.length > 0) {
      // Deliveries are recorded per recipient, so the retry this triggers
      // only reaches the members who did not get theirs.
      const names = result.failed.map((failure) => `${failure.name}: ${failure.error}`).join("; ");
      throw new Error(`${result.failed.length} statement(s) of period ${periodId} not sent (${names})`);
    }
  },
};

/** Job messages arrive as JSON from outside the process: checked before they run. */
const jobSchema: z.ZodType<Job> = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("period-statements"),
    payload: z.object({ periodId: z.string().min(1), force: z.boolean().optional() }),
  }),
]);

export async function runJob(job: Job): Promise<void> {
  // Each handler takes its own job's payload; the union cannot express that pairing.
  const handler = jobHandlers[job.name] as (payload: Job["payload"]) => Promise<void>;
  await handler(job.payload);
}

/** Runs a job message taken off a queue. Throws when it is malformed or fails, so the queue retries it. */
export async function runQueuedJob(message: unknown): Promise<void> {
  await runJob(jobSchema.parse(message));
}

function logFailures(kind: string, results: readonly NotificationResult[]): void {
  for (const failure of results.filter((result) => !result.ok)) {
    console.error(`[${kind}] ${failure.office} / ${failure.session}: ${failure.error}`);
  }
}

const tasks: Record<ScheduleName, ScheduledTask["run"]> = {
  async "session-notifications"() {
    const [started, cutoff] = await Promise.all([sendSessionNotifications(), sendCutoffNotifications()]);
    logFailures("session-notifications", started);
    logFailures("cutoff-notifications", cutoff);
  },
  async "oauth-token-prune"() {
    const { deleted } = await pruneExpiredOauthTokens();
    console.log(`[oauth-token-prune] ${deleted} expired token(s) deleted`);
  },
  async "monthly-reimbursement"(now) {
    const { closed, offices } = await closeMonthlyReimbursements({ now });
    const created = [...offices.values()].filter((office) => office.status === "created").length;
    console.log(`[monthly-reimbursement] ${closed.month}/${closed.year}: ${created} of ${offices.size} office(s) closed`);
  },
};

export const scheduledTasks: readonly ScheduledTask[] = Object.entries(SCHEDULES).map(([name, cron]) => ({
  name,
  cron,
  run: tasks[name as ScheduleName],
}));

/**
 * Runs every task scheduled on `cron`, side by side: one failing does not
 * stop the others. Rejects when any failed, so the platform records the run
 * as failed.
 */
export async function runScheduledTasks(cron: string, now: Date): Promise<void> {
  const due = scheduledTasks.filter((task) => task.cron === cron);
  if (due.length === 0) {
    console.warn(`[scheduled] no task runs on "${cron}"`);
    return;
  }
  const results = await Promise.allSettled(due.map((task) => task.run(now)));
  const failures = results.flatMap((result, index) =>
    result.status === "rejected" ? [new Error(`${due[index].name} failed`, { cause: result.reason })] : [],
  );
  if (failures.length > 0) throw new AggregateError(failures, `Scheduled run "${cron}" failed`);
}
