/**
 * When each scheduled task runs: five-field cron expressions, in UTC.
 *
 * Kept apart from the registry (./index.ts) so the admin screen can list them
 * without pulling in server code. Every platform's trigger list must contain
 * each expression: wrangler.jsonc `triggers.crons` on Cloudflare, checked by
 * tests/platform/schedules.test.ts.
 */
export const SCHEDULES = {
  /**
   * Session start and cutoff messages. Sessions start on multiples of
   * SCHEDULE_STEP_MINUTES and the notifiers look back two steps, deduplicated
   * per day, so a tick every step catches each session exactly once in every
   * timezone, across DST changes.
   */
  "session-notifications": "*/5 * * * *",
  /** MCP OAuth tokens whose refresh token has expired. */
  "oauth-token-prune": "0 2 * * *",
  /** Closes the previous month and mails the statements. */
  "monthly-reimbursement": "0 2 1 * *",
} as const;

export type ScheduleName = keyof typeof SCHEDULES;
