import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { SCHEDULES } from "../../src/jobs/schedules";

// Next resolves `server-only` with the react-server condition; outside Next it throws on import.
await mock.module("server-only", () => ({}));
const { runQueuedJob, runScheduledTasks, scheduledTasks } = await import("../../src/jobs");

test("a malformed queue message is rejected before any work, so the queue retries it", async () => {
  await assert.rejects(runQueuedJob({ name: "unknown-job", payload: {} }));
  await assert.rejects(runQueuedJob({ name: "period-statements", payload: {} }));
  await assert.rejects(runQueuedJob("period-statements"));
});

test("every schedule has a task, under the schedule's name", () => {
  assert.deepEqual(
    scheduledTasks.map(({ name, cron }) => [name, cron]),
    Object.entries(SCHEDULES),
  );
});

test("a cron no task runs on is a no-op", async () => {
  await assert.doesNotReject(runScheduledTasks("1 1 1 1 1", new Date()));
});
