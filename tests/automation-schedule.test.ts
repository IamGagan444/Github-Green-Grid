import { describe, expect, it } from "vitest";

import {
  commitWindow,
  describeScheduleTimes,
  executionKey,
  formatScheduleTime,
  getDueRuns,
  getNextRun,
  isManualSlot,
  localDayKey,
  runCommitWindow,
  runInstantFor,
} from "@/lib/automation/schedule";
import { AppError } from "@/lib/errors";
import { automationFormSchema, scheduleTimesSchema } from "@/validators/automation";

const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;
const IST_5PM = { daysOfWeek: WEEKDAYS, scheduleTimes: ["17:00"], timezone: "Asia/Kolkata" };
const IST_THREE = { daysOfWeek: WEEKDAYS, scheduleTimes: ["17:00", "09:00", "13:00"], timezone: "Asia/Kolkata" };

describe("timezone-aware run instants", () => {
  it("resolves 5:00 PM Asia/Kolkata to 11:30 UTC regardless of server timezone", () => {
    expect(runInstantFor("2026-09-30", "17:00", "Asia/Kolkata").toISOString()).toBe("2026-09-30T11:30:00.000Z");
  });

  it("handles DST: 9:00 America/New_York is 13:00Z in summer and 14:00Z in winter", () => {
    expect(runInstantFor("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(runInstantFor("2026-12-01", "09:00", "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
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

describe("getDueRuns", () => {
  it("is due at and shortly after the scheduled time on a selected weekday", () => {
    // Wednesday 2026-09-30, 17:05 IST
    expect(getDueRuns(IST_5PM, new Date("2026-09-30T11:35:00Z"))).toEqual([
      { executionDate: "2026-09-30", slot: "17:00", scheduledFor: new Date("2026-09-30T11:30:00Z") },
    ]);
  });

  it("is not due before the scheduled time", () => {
    expect(getDueRuns(IST_5PM, new Date("2026-09-30T11:29:00Z"))).toEqual([]);
  });

  it("is not due on unselected days (Saturday)", () => {
    expect(getDueRuns(IST_5PM, new Date("2026-10-03T11:35:00Z"))).toEqual([]);
  });

  it("stops being due once the grace window has passed", () => {
    expect(getDueRuns(IST_5PM, new Date("2026-09-30T11:35:00Z"), 60)).toHaveLength(1);
    expect(getDueRuns(IST_5PM, new Date("2026-09-30T13:00:00Z"), 60)).toEqual([]);
  });

  it("catches a late-evening schedule from a poll just after local midnight", () => {
    const late = { daysOfWeek: WEEKDAYS, scheduleTimes: ["23:50"], timezone: "Asia/Kolkata" };
    // 00:10 IST Thursday = 18:40Z Wednesday
    expect(getDueRuns(late, new Date("2026-09-30T18:40:00Z"))[0]?.executionDate).toBe("2026-09-30");
  });

  it("returns every due time of the day, oldest first", () => {
    // 17:05 IST: 13:00 and 17:00 are inside the 6-hour grace window; 09:00 (8h ago) is not.
    const due = getDueRuns(IST_THREE, new Date("2026-09-30T11:35:00Z"));
    expect(due.map((run) => run.slot)).toEqual(["13:00", "17:00"]);
  });
});

describe("getNextRun", () => {
  it("skips the weekend", () => {
    // Friday 2026-10-02 after 5 PM IST → next is Monday 2026-10-05
    const next = getNextRun(IST_5PM, new Date("2026-10-02T12:00:00Z"));
    expect(next?.executionDate).toBe("2026-10-05");
    expect(next?.scheduledFor.toISOString()).toBe("2026-10-05T11:30:00.000Z");
  });

  it("picks the next time later the same day", () => {
    // 10:00 IST Wednesday → 13:00 IST the same day
    const next = getNextRun(IST_THREE, new Date("2026-09-30T04:30:00Z"));
    expect(next).toMatchObject({ executionDate: "2026-09-30", slot: "13:00" });
  });

  it("returns null with no days selected", () => {
    expect(getNextRun({ ...IST_5PM, daysOfWeek: [] })).toBeNull();
  });
});

describe("commit ranges", () => {
  it("SAME_DAY day window covers the execution's full local day", () => {
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

  it("the first post of the day starts at local midnight", () => {
    const end = new Date("2026-09-30T03:30:00Z");
    expect(
      runCommitWindow({ executionDate: "2026-09-30", timezone: "Asia/Kolkata", mode: "SAME_DAY", end, previousEnd: null }),
    ).toEqual({ dateKey: "2026-09-30", since: new Date("2026-09-29T18:30:00Z"), until: end });
  });

  it("a later post starts where the previous post ended", () => {
    const previousEnd = new Date("2026-09-30T03:30:00Z");
    const end = new Date("2026-09-30T11:30:00Z");
    expect(
      runCommitWindow({ executionDate: "2026-09-30", timezone: "Asia/Kolkata", mode: "SAME_DAY", end, previousEnd }),
    ).toMatchObject({ since: previousEnd, until: end });
  });

  it("ignores a previous end from before the day started", () => {
    const window = runCommitWindow({
      executionDate: "2026-09-30",
      timezone: "Asia/Kolkata",
      mode: "SAME_DAY",
      end: new Date("2026-09-30T11:30:00Z"),
      previousEnd: new Date("2026-09-29T10:00:00Z"),
    });
    expect(window.since).toEqual(new Date("2026-09-29T18:30:00Z"));
  });
});

describe("schedule time validation", () => {
  it("accepts 1–24 distinct times and stores them sorted", () => {
    expect(scheduleTimesSchema.parse(["17:00", "09:00"])).toEqual(["09:00", "17:00"]);
    expect(scheduleTimesSchema.safeParse([]).success).toBe(false);
    expect(scheduleTimesSchema.safeParse(["09:00", "09:00"]).success).toBe(false);
    const all = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
    expect(scheduleTimesSchema.safeParse(all).success).toBe(true);
    expect(scheduleTimesSchema.safeParse([...all, "12:30"]).success).toBe(false);
  });

  it("allows only one time in previous-day mode", () => {
    const base = {
      name: "Daily",
      githubSources: [{ repositoryId: "1", owner: "acme", name: "api", branch: null }],
      slackIntegrationId: "slack_1",
      slackChannelId: "C0123456",
      slackChannelName: "standups",
      daysOfWeek: ["MONDAY"],
      timezone: "Asia/Kolkata",
    };
    expect(automationFormSchema.safeParse({ ...base, commitWindow: "SAME_DAY", scheduleTimes: ["09:00", "17:00"] }).success).toBe(true);
    const previousDay = automationFormSchema.safeParse({ ...base, commitWindow: "PREVIOUS_DAY", scheduleTimes: ["09:00", "17:00"] });
    expect(previousDay.success).toBe(false);
    expect(previousDay.error?.issues[0]?.path).toEqual(["scheduleTimes"]);
  });
});

describe("helpers", () => {
  it("builds the per-slot idempotency key and recognises manual slots", () => {
    expect(executionKey("auto_1", "2026-09-30", "17:00")).toBe("auto_1:2026-09-30:17:00");
    expect(isManualSlot("manual-1790000000000")).toBe(true);
    expect(isManualSlot("17:00")).toBe(false);
  });

  it("formats times", () => {
    expect(formatScheduleTime("17:00")).toBe("5:00 PM");
    expect(formatScheduleTime("00:05")).toBe("12:05 AM");
    expect(describeScheduleTimes(["17:00"])).toBe("5:00 PM");
    expect(describeScheduleTimes(["17:00", "09:00"])).toBe("9:00 AM and 5:00 PM");
    expect(describeScheduleTimes(["09:00", "10:00", "11:00", "12:00", "13:00"])).toBe("9:00 AM, 10:00 AM, 11:00 AM +2 more");
  });
});
