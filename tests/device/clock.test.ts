import { describe, expect, test } from "bun:test";
import { deviceClock, formatTime, isTimeZone, nextOffsetChange, utcOffset } from "@/lib/device/clock";

const ZURICH = "Europe/Zurich";

describe("a terminal's clock", () => {
  test("24- or 12-hour figures, in Latin-1 for the panel", () => {
    const afternoon = new Date("2026-10-11T12:05:00Z"); // 14:05 in Zurich
    expect(formatTime(afternoon, ZURICH, "24")).toBe("14:05");
    expect(formatTime(afternoon, ZURICH, "12")).toBe("2:05 PM");
    const midnight = new Date("2026-10-11T22:00:00Z"); // 00:00
    expect(formatTime(midnight, ZURICH, "24")).toBe("00:00");
    expect(formatTime(midnight, ZURICH, "12")).toBe("12:00 AM");
    expect(formatTime(new Date("2026-10-11T10:30:00Z"), ZURICH, "12")).toBe("12:30 PM");
  });

  test("its offset, and the next change of it to the minute", () => {
    expect(utcOffset(new Date("2026-10-11T12:00:00Z"), ZURICH)).toBe(120);
    // Winter time on Sunday 25 October 2026 at 03:00 summer time, 01:00 UTC.
    expect(nextOffsetChange(ZURICH, new Date("2026-10-20T12:00:00Z"))).toEqual({ at: new Date("2026-10-25T01:00:00Z"), offset: 60 });
    expect(nextOffsetChange(ZURICH, new Date("2026-07-01T12:00:00Z"))).toBeNull();
    expect(nextOffsetChange("Asia/Tokyo", new Date("2026-10-20T12:00:00Z"))).toBeNull();
  });

  test("its own time zone and format, else its office's", () => {
    const office = { timezone: ZURICH };
    const now = new Date("2026-10-11T12:00:00Z");
    expect(deviceClock({ timezone: null, timeFormat: "24", office }, now)).toEqual({ offset: 120, next: null, format: "24", date: true });
    expect(deviceClock({ timezone: "America/New_York", timeFormat: "12", showDate: false, office }, now)).toEqual({ offset: -240, next: null, format: "12", date: false });
    expect(isTimeZone("Europe/Zurich")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
  });
});
