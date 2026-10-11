import { describe, expect, test } from "bun:test";
import { hoursAt, parseDays, wakeWords, zonedInstant, type OfficeHours } from "@/lib/device/hours";

const ZURICH = "Europe/Zurich";
const WEEKDAYS: OfficeHours = { from: "07:30", until: "19:00", days: [1, 2, 3, 4, 5] };

describe("a terminal's office hours", () => {
  test("local times become instants, summer and winter", () => {
    expect(zonedInstant(new Date("2026-07-15T00:00:00Z"), "07:30", ZURICH).toISOString()).toBe("2026-07-15T05:30:00.000Z");
    expect(zonedInstant(new Date("2026-01-15T00:00:00Z"), "07:30", ZURICH).toISOString()).toBe("2026-01-15T06:30:00.000Z");
    // The night clocks go back (25 October 2026, 03:00 → 02:00): 07:30 is already winter time.
    expect(zonedInstant(new Date("2026-10-25T00:00:00Z"), "07:30", ZURICH).toISOString()).toBe("2026-10-25T06:30:00.000Z");
  });

  test("open on a weekday, until it closes", () => {
    // Wednesday 14 October 2026, 10:00 in Zurich.
    const now = new Date("2026-10-14T08:00:00Z");
    expect(hoursAt(WEEKDAYS, ZURICH, now)).toEqual({ open: true, until: new Date("2026-10-14T17:00:00Z"), weekend: false });
  });

  test("closed in the night: until the morning, not a weekend", () => {
    const evening = new Date("2026-10-14T19:00:00Z"); // 21:00
    expect(hoursAt(WEEKDAYS, ZURICH, evening)).toEqual({ open: false, until: new Date("2026-10-15T05:30:00Z"), weekend: false });
    const early = new Date("2026-10-15T03:00:00Z"); // 05:00 the next day
    expect(hoursAt(WEEKDAYS, ZURICH, early).until).toEqual(new Date("2026-10-15T05:30:00Z"));
  });

  test("closed from Friday evening: until Monday, a weekend", () => {
    const friday = new Date("2026-10-16T18:00:00Z"); // Friday 20:00
    expect(hoursAt(WEEKDAYS, ZURICH, friday)).toEqual({ open: false, until: new Date("2026-10-19T05:30:00Z"), weekend: true });
  });

  test("days parse leniently, and a week without opening stays closed", () => {
    expect(parseDays("5, 1,1,9,x,3")).toEqual([1, 3, 5]);
    const never = hoursAt({ ...WEEKDAYS, days: [] }, ZURICH, new Date("2026-10-14T08:00:00Z"));
    expect(never.open).toBe(false);
    expect(never.weekend).toBe(true);
  });

  test("a day without opening is still the weekend, its evening included", () => {
    const sunday = new Date("2026-10-18T12:00:00Z"); // Sunday 14:00
    expect(hoursAt(WEEKDAYS, ZURICH, sunday)).toEqual({ open: false, until: new Date("2026-10-19T05:30:00Z"), weekend: true });
    const thursday = new Date("2026-10-15T19:00:00Z"); // Thursday 21:00: only a night
    expect(hoursAt(WEEKDAYS, ZURICH, thursday).weekend).toBe(false);
  });

  test("the night screen names the day only beyond the next morning", () => {
    const monday = new Date("2026-10-19T05:30:00Z"); // Monday 07:30 in Zurich
    // From Friday evening: "Réveil lundi à 07:30".
    expect(wakeWords(monday, ZURICH, "fr", new Date("2026-10-16T18:00:00Z"))).toEqual({ day: "lundi", time: "07:30" });
    expect(wakeWords(monday, ZURICH, "en", new Date("2026-10-16T18:00:00Z"))).toEqual({ day: "Monday", time: "07:30" });
    // From Sunday evening, or early on Monday: "Réveil à 07:30".
    expect(wakeWords(monday, ZURICH, "fr", new Date("2026-10-18T20:00:00Z"))).toEqual({ day: "", time: "07:30" });
    expect(wakeWords(monday, ZURICH, "fr", new Date("2026-10-19T02:00:00Z"))).toEqual({ day: "", time: "07:30" });
  });
});
