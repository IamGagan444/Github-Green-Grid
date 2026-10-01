import { describe, expect, it } from "vitest";

import {
  commitWindow,
  executionKey,
  formatScheduleTime,
  getDueRun,
  getNextRun,
  localDayKey,
  runInstantFor,
} from "@/lib/automation/schedule";
import { AppError } from "@/lib/errors";

const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;
const IST_5PM = { daysOfWeek: WEEKDAYS, scheduleTime: "17:00", timezone: "Asia/Kolkata" };

describe("timezone-aware run instants", () => {
  it("resolves 5:00 PM Asia/Kolkata to 11:30 UTC regardless of server timezone", () => {
    expect(runInstantFor("2026-09-30", IST_5PM).toISOString()).toBe("2026-09-30T11:30:00.000Z");
  });

  it("handles DST: 9:00 America/New_York is 13:00Z in summer and 14:00Z in winter", () => {
    const timing = { daysOfWeek: WEEKDAYS, scheduleTime: "09:00", timezone: "America/New_York" };
    expect(runInstantFor("2026-07-01", timing).toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(runInstantFor("2026-12-01", timing).toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });

  it("computes the local day from a UTC instant", () => {
    expect(localDayKey(new Date("2026-09-30T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10-01");
    expect(localDayKey(new Date("2026-09-30T20:00:00Z"), "America/Los_Angeles")).toBe("2026-09-30");
  });

  it("rejects invalid timezones with a typed error", () => {
    expect(() => localDayKey(new Date(), "Mars/Olympus")).toThrow(AppError);
    try {
      localDayKey(new Date(), "Mars/Olympus");
    } catch (error) {
      expect((error as AppError).code).toBe("TIMEZONE_INVALID");
    }
  });
});

describe("getDueRun", () => {
  it("is due at and shortly after the scheduled time on a selected weekday", () => {
    // Wednesday 2026-09-30, 17:05 IST
    const due = getDueRun(IST_5PM, new Date("2026-09-30T11:35:00Z"));
    expect(due).toEqual({ executionDate: "2026-09-30", scheduledFor: new Date("2026-09-30T11:30:00Z") });
  });

  it("is not due before the scheduled time", () => {
    expect(getDueRun(IST_5PM, new Date("2026-09-30T11:29:00Z"))).toBeNull();
  });

  it("is not due on unselected days (Saturday)", () => {
    expect(getDueRun(IST_5PM, new Date("2026-10-03T11:35:00Z"))).toBeNull();
  });

  it("stops being due once the grace window has passed", () => {
    expect(getDueRun(IST_5PM, new Date("2026-09-30T11:35:00Z"), 60)).not.toBeNull();
    expect(getDueRun(IST_5PM, new Date("2026-09-30T13:00:00Z"), 60)).toBeNull();
  });

  it("catches a late-evening schedule from a poll just after local midnight", () => {
    const late = { daysOfWeek: WEEKDAYS, scheduleTime: "23:50", timezone: "Asia/Kolkata" };
    // 00:10 IST Thursday = 18:40Z Wednesday
    const due = getDueRun(late, new Date("2026-09-30T18:40:00Z"));
    expect(due?.executionDate).toBe("2026-09-30");
  });
});

describe("getNextRun", () => {
  it("skips the weekend", () => {
    // Friday 2026-10-02 after 5 PM IST → next is Monday 2026-10-05
    const next = getNextRun(IST_5PM, new Date("2026-10-02T12:00:00Z"));
    expect(next?.executionDate).toBe("2026-10-05");
    expect(next?.scheduledFor.toISOString()).toBe("2026-10-05T11:30:00.000Z");
  });

  it("returns null with no days selected", () => {
    expect(getNextRun({ ...IST_5PM, daysOfWeek: [] })).toBeNull();
  });
});

describe("commitWindow", () => {
  it("SAME_DAY covers the execution's full local day", () => {
    expect(commitWindow("2026-09-30", "Asia/Kolkata", "SAME_DAY")).toEqual({
      dateKey: "2026-09-30",
      since: new Date("2026-09-29T18:30:00Z"),
      until: new Date("2026-09-30T18:30:00Z"),
    });
  });

  it("PREVIOUS_DAY covers the local day before", () => {
    expect(commitWindow("2026-09-30", "Asia/Kolkata", "PREVIOUS_DAY").dateKey).toBe("2026-09-29");
  });

  it("is 23 hours long across a spring-forward transition", () => {
    const window = commitWindow("2026-03-08", "America/New_York", "SAME_DAY");
    expect((window.until.getTime() - window.since.getTime()) / 3_600_000).toBe(23);
  });
});

describe("helpers", () => {
  it("builds the per-day idempotency key and formats times", () => {
    expect(executionKey("auto_1", "2026-09-30")).toBe("auto_1:2026-09-30");
    expect(formatScheduleTime("17:00")).toBe("5:00 PM");
    expect(formatScheduleTime("00:05")).toBe("12:05 AM");
  });
});
