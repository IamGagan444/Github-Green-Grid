import { describe, expect, it } from "vitest";

import {
  addDaysToDayKey,
  formatUtcOffset,
  getLocalDayKey,
  getTimezoneOffsetMs,
  getWallClock,
  isValidTimezone,
  weekdayFromDayKey,
  zonedTimeToUtc,
} from "@/lib/schedule/timezone";

describe("isValidTimezone", () => {
  it("accepts IANA identifiers", () => {
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });

  it("rejects nonsense and empty values", () => {
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("getTimezoneOffsetMs", () => {
  it("resolves a fixed half-hour offset", () => {
    const offset = getTimezoneOffsetMs(new Date("2026-09-01T00:00:00Z"), "Asia/Kolkata");
    expect(offset).toBe(5.5 * 60 * 60 * 1000);
  });

  it("tracks daylight saving transitions", () => {
    const winter = getTimezoneOffsetMs(new Date("2026-01-15T12:00:00Z"), "America/New_York");
    const summer = getTimezoneOffsetMs(new Date("2026-07-15T12:00:00Z"), "America/New_York");

    expect(winter).toBe(-5 * 60 * 60 * 1000);
    expect(summer).toBe(-4 * 60 * 60 * 1000);
  });
});

describe("zonedTimeToUtc", () => {
  it("converts wall-clock time to the correct UTC instant", () => {
    const utc = zonedTimeToUtc(2026, 9, 1, 9, 0, "Asia/Kolkata");
    expect(utc.toISOString()).toBe("2026-09-01T03:30:00.000Z");
  });

  it("uses the offset in effect on the target date, not today's", () => {
    const winter = zonedTimeToUtc(2026, 1, 15, 9, 0, "America/New_York");
    const summer = zonedTimeToUtc(2026, 7, 15, 9, 0, "America/New_York");

    expect(winter.toISOString()).toBe("2026-01-15T14:00:00.000Z");
    expect(summer.toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("round-trips through getWallClock", () => {
    const utc = zonedTimeToUtc(2026, 3, 29, 14, 30, "Europe/Berlin");
    const wall = getWallClock(utc, "Europe/Berlin");

    expect(wall.year).toBe(2026);
    expect(wall.month).toBe(3);
    expect(wall.day).toBe(29);
    expect(wall.hour).toBe(14);
    expect(wall.minute).toBe(30);
  });
});

describe("day keys", () => {
  it("derives the local day, not the UTC day", () => {
    // 22:30 UTC is already the next calendar day in Kolkata.
    const instant = new Date("2026-08-31T22:30:00Z");
    expect(getLocalDayKey(instant, "UTC")).toBe("2026-08-31");
    expect(getLocalDayKey(instant, "Asia/Kolkata")).toBe("2026-09-01");
  });

  it("adds and subtracts days across month boundaries", () => {
    expect(addDaysToDayKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysToDayKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToDayKey("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("maps day keys to weekdays", () => {
    expect(weekdayFromDayKey("2026-09-01")).toBe("TUESDAY");
    expect(weekdayFromDayKey("2026-09-06")).toBe("SUNDAY");
  });
});

describe("formatUtcOffset", () => {
  it("renders half-hour offsets", () => {
    expect(formatUtcOffset("Asia/Kolkata", new Date("2026-09-01T00:00:00Z"))).toBe("UTC+05:30");
  });

  it("renders negative offsets", () => {
    expect(formatUtcOffset("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(
      "UTC-05:00",
    );
  });
});
