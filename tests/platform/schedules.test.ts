import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SCHEDULES } from "../../src/jobs/schedules";

/** wrangler.jsonc, whose comments all stand on their own lines. */
async function wranglerConfig(): Promise<{ triggers: { crons: string[] } }> {
  const source = await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  const json = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  return JSON.parse(json);
}

test("Cloudflare fires every scheduled task's cron, and nothing else", async () => {
  const { triggers } = await wranglerConfig();
  assert.deepEqual([...triggers.crons].sort(), Object.values(SCHEDULES).sort());
});

test("each cron runs a single task, so a trigger maps to one piece of work", () => {
  const crons = Object.values(SCHEDULES);
  assert.equal(new Set(crons).size, crons.length);
});
