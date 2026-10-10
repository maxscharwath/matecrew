import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSyncTimes, parseSyncTimes } from "../../src/lib/device/sync-times";

test("parseSyncTimes reads the stored list in order", () => {
  assert.deepEqual(parseSyncTimes("08:00,12:00,15:00,18:00"), ["08:00", "12:00", "15:00", "18:00"]);
});

test("parseSyncTimes trims and drops blanks and malformed times", () => {
  assert.deepEqual(parseSyncTimes(" 07:30 ,, 24:00,9:00,23:59,"), ["07:30", "23:59"]);
  assert.deepEqual(parseSyncTimes(""), []);
});

test("formatSyncTimes round-trips through parseSyncTimes", () => {
  const times = ["06:45", "12:00", "17:15"];
  assert.equal(formatSyncTimes(times), "06:45,12:00,17:15");
  assert.deepEqual(parseSyncTimes(formatSyncTimes(times)), times);
  assert.equal(formatSyncTimes([]), "");
});

test("formatSyncTimes refuses a time that is not HH:MM", () => {
  assert.throws(() => formatSyncTimes(["08:00", "8h"]), RangeError);
});
