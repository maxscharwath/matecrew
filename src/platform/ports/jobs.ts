/**
 * Background jobs and scheduled tasks.
 *
 * A job is slow work taken out of a request or a scheduled run, such as
 * mailing one office's statements. It is a plain JSON message: the adapter
 * moves it (Cloudflare Queue, Azure Service Bus, in-process on Node) and the
 * job registry in src/jobs runs it. Jobs may be delivered more than once, so
 * every handler must be idempotent.
 *
 * A scheduled task is business work run on a cron expression (UTC). The
 * platform entry (Cloudflare Cron Triggers, Azure Functions timer triggers)
 * only finds the tasks matching the expression that fired and runs them.
 */

/** Each job's payload, by job name. A new job is added here, then handled in src/jobs. */
export interface JobPayloads {
  /** Mail every member of a closed reimbursement period their statement. */
  "period-statements": {
    readonly periodId: string;
    /** Send again to members who already received it. */
    readonly force?: boolean;
  };
}

export type JobName = keyof JobPayloads;

/** One job message: its name and its payload. */
export type Job = {
  [Name in JobName]: { readonly name: Name; readonly payload: JobPayloads[Name] };
}[JobName];

export interface JobQueue {
  /** Hands the job over for delivery; resolves once it is accepted, not once it has run. */
  enqueue(job: Job): Promise<void>;
}

/** The function that runs each job. */
export type JobHandlers = {
  readonly [Name in JobName]: (payload: JobPayloads[Name]) => Promise<void>;
};

/** Business work run on a schedule. */
export interface ScheduledTask {
  /** Stable identifier, also used by the admin "run now" screen and in logs. */
  readonly name: string;
  /** Five-field cron expression, in UTC. Every platform's trigger list must contain it. */
  readonly cron: string;
  run(now: Date): Promise<void>;
}
