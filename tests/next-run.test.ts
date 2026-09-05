import { describe, expect, it } from "vitest";

import {
  clampCommitsPerDay,
  describeCommitWindow,
  describeFrequency,
  getDueOccurrences,
  getNextOccurrence,
  getOccurrencesForDay,
  getSlotHours,
  getUpcomingOccurrences,
  MAX_COMMITS_PER_DAY,
} from "@/lib/schedule/next-run";

const WEEKDAY_SCHEDULE = {
  timezone: "Asia/Kolkata",
  commitsPerDay: 1,
  daysOfWeek: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
} as const;

describe("getSlotHours", () => {
  it("puts a single daily commit at the preferred hour", () => {
    expect(getSlotHours(1)).toEqual([9]);
  });

  it("spreads commits one per hour", () => {
    expect(getSlotHours(5)).toEqual([9, 10, 11, 12, 13]);
  });

  it("slides the window earlier so it never wraps past midnight", () => {
    const hours = getSlotHours(20);

    expect(hours).toHaveLength(20);
    expect(hours[0]).toBe(4);
    expect(hours.at(-1)).toBe(23);
    expect(hours.every((hour) => hour >= 0 && hour <= 23)).toBe(true);
  });

  it("keeps hours strictly increasing with no gaps", () => {
    for (let count = 1; count <= MAX_COMMITS_PER_DAY; count += 1) {
      const hours = getSlotHours(count);
      expect(hours).toHaveLength(count);
      for (let index = 1; index < hours.length; index += 1) {
        expect(hours[index]! - hours[index - 1]!).toBe(1);
      }
    }
  });
});

describe("clampCommitsPerDay", () => {
  it("clamps out-of-range and non-finite values", () => {
    expect(clampCommitsPerDay(0)).toBe(1);
    expect(clampCommitsPerDay(-5)).toBe(1);
    expect(clampCommitsPerDay(999)).toBe(20);
    expect(clampCommitsPerDay(Number.NaN)).toBe(1);
    expect(clampCommitsPerDay(3.7)).toBe(3);
  });
});

describe("getOccurrencesForDay", () => {
  it("returns one occurrence per commit, chronologically", () => {
    const occurrences = getOccurrencesForDay({ ...WEEKDAY_SCHEDULE, commitsPerDay: 3 }, "2026-09-01");

    expect(occurrences.map((entry) => entry.slotIndex)).toEqual([0, 1, 2]);
    expect(occurrences.map((entry) => entry.runAt.toISOString())).toEqual([
      "2026-09-01T03:30:00.000Z", // 09:00 IST
      "2026-09-01T04:30:00.000Z", // 10:00 IST
      "2026-09-01T05:30:00.000Z", // 11:00 IST
    ]);
  });

  it("keeps every slot inside the same local day", () => {
    const occurrences = getOccurrencesForDay(
      { ...WEEKDAY_SCHEDULE, commitsPerDay: 20 },
      "2026-09-01",
    );

    for (const occurrence of occurrences) {
      expect(occurrence.dayKey).toBe("2026-09-01");
    }
  });
});

describe("getNextOccurrence", () => {
  it("returns today's slot when it has not fired yet", () => {
    // 2026-09-01 is a Tuesday; 01:00 UTC is 06:30 local, before 09:00.
    const next = getNextOccurrence(WEEKDAY_SCHEDULE, new Date("2026-09-01T01:00:00Z"));

    expect(next?.dayKey).toBe("2026-09-01");
    expect(next?.slotIndex).toBe(0);
    expect(next?.runAt.toISOString()).toBe("2026-09-01T03:30:00.000Z");
  });

  it("advances to the next slot within the same day", () => {
    const next = getNextOccurrence(
      { ...WEEKDAY_SCHEDULE, commitsPerDay: 3 },
      new Date("2026-09-01T04:00:00Z"),
    );

    expect(next?.dayKey).toBe("2026-09-01");
    expect(next?.slotIndex).toBe(1);
  });

  it("rolls to the next selected day once the last slot has passed", () => {
    const next = getNextOccurrence(WEEKDAY_SCHEDULE, new Date("2026-09-01T05:00:00Z"));
    expect(next?.dayKey).toBe("2026-09-02");
    expect(next?.slotIndex).toBe(0);
  });

  it("skips unselected days", () => {
    // Friday after the run time: the next weekday slot is Monday.
    const next = getNextOccurrence(WEEKDAY_SCHEDULE, new Date("2026-09-04T06:00:00Z"));
    expect(next?.dayKey).toBe("2026-09-07");
  });

  it("returns null when no days are selected", () => {
    expect(
      getNextOccurrence({ timezone: "UTC", commitsPerDay: 1, daysOfWeek: [] }),
    ).toBeNull();
  });
});

describe("getDueOccurrences", () => {
  it("is empty before the scheduled time", () => {
    expect(getDueOccurrences(WEEKDAY_SCHEDULE, new Date("2026-09-01T03:29:00Z"))).toEqual([]);
  });

  it("is due at the scheduled time", () => {
    const due = getDueOccurrences(WEEKDAY_SCHEDULE, new Date("2026-09-01T03:30:00Z"));
    expect(due).toHaveLength(1);
    expect(due[0]?.dayKey).toBe("2026-09-01");
    expect(due[0]?.slotIndex).toBe(0);
  });

  it("stops being due once the grace window elapses", () => {
    expect(getDueOccurrences(WEEKDAY_SCHEDULE, new Date("2026-09-01T05:30:00Z"))).toEqual([]);
  });

  it("returns several slots when a poll was missed", () => {
    // 04:50 UTC is 10:20 IST: the 09:00 and 10:00 slots are both inside grace.
    const due = getDueOccurrences(
      { ...WEEKDAY_SCHEDULE, commitsPerDay: 5 },
      new Date("2026-09-01T04:50:00Z"),
    );

    expect(due.map((entry) => entry.slotIndex)).toEqual([0, 1]);
  });

  it("returns slots in chronological order", () => {
    const due = getDueOccurrences(
      { ...WEEKDAY_SCHEDULE, commitsPerDay: 5 },
      new Date("2026-09-01T04:50:00Z"),
    );

    for (let index = 1; index < due.length; index += 1) {
      expect(due[index]!.runAt.getTime()).toBeGreaterThan(due[index - 1]!.runAt.getTime());
    }
  });

  it("is never due on an unselected day", () => {
    // 2026-09-05 is a Saturday.
    expect(getDueOccurrences(WEEKDAY_SCHEDULE, new Date("2026-09-05T04:00:00Z"))).toEqual([]);
  });

  it("attributes a run to the local day, not the UTC day", () => {
    // 20 commits start at 04:00 IST, which is 22:30 UTC the previous day.
    const due = getDueOccurrences(
      { timezone: "Asia/Kolkata", commitsPerDay: 20, daysOfWeek: ["TUESDAY"] },
      new Date("2026-08-31T22:35:00Z"),
    );

    expect(due).toHaveLength(1);
    expect(due[0]?.dayKey).toBe("2026-09-01");
  });
});

describe("getUpcomingOccurrences", () => {
  it("returns strictly increasing occurrences across days", () => {
    const upcoming = getUpcomingOccurrences(
      WEEKDAY_SCHEDULE,
      5,
      new Date("2026-09-01T01:00:00Z"),
    );

    expect(upcoming.map((entry) => entry.dayKey)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-07",
    ]);
  });

  it("walks slots within a day before moving on", () => {
    const upcoming = getUpcomingOccurrences(
      { ...WEEKDAY_SCHEDULE, commitsPerDay: 3 },
      4,
      new Date("2026-09-01T01:00:00Z"),
    );

    expect(upcoming.map((entry) => entry.dayKey + "#" + entry.slotIndex)).toEqual([
      "2026-09-01#0",
      "2026-09-01#1",
      "2026-09-01#2",
      "2026-09-02#0",
    ]);
  });

  it("returns an empty list when the schedule can never fire", () => {
    expect(
      getUpcomingOccurrences({ timezone: "UTC", commitsPerDay: 1, daysOfWeek: [] }, 3),
    ).toEqual([]);
  });
});

describe("describeCommitWindow", () => {
  it("describes a single daily commit", () => {
    expect(describeCommitWindow(1)).toBe("1 commit at 9:00 AM");
  });

  it("describes an hourly window", () => {
    expect(describeCommitWindow(20)).toBe("20 commits, hourly from 4:00 AM to 11:00 PM");
  });
});

describe("describeFrequency", () => {
  it("names common patterns", () => {
    expect(describeFrequency(WEEKDAY_SCHEDULE.daysOfWeek)).toBe("Every weekday");
    expect(
      describeFrequency([
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ]),
    ).toBe("Every day");
    expect(describeFrequency(["SATURDAY", "SUNDAY"])).toBe("Weekends");
  });

  it("lists irregular patterns in weekday order", () => {
    expect(describeFrequency(["FRIDAY", "MONDAY", "WEDNESDAY"])).toBe("Mon, Wed, Fri");
  });

  it("handles the empty case", () => {
    expect(describeFrequency([])).toBe("No days selected");
  });
});
