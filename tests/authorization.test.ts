import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

const scheduleFindFirst = vi.fn();
const scheduleDeleteMany = vi.fn();
const scheduleUpdate = vi.fn();
const repositoryFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    schedule: {
      findFirst: (...args: unknown[]) => scheduleFindFirst(...args),
      deleteMany: (...args: unknown[]) => scheduleDeleteMany(...args),
      update: (...args: unknown[]) => scheduleUpdate(...args),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    repository: { findFirst: (...args: unknown[]) => repositoryFindFirst(...args) },
    user: { findUniqueOrThrow: vi.fn() },
  },
}));

const { getOwnedSchedule, updateSchedule, deleteSchedule } = await import(
  "@/lib/services/schedules"
);

const OWNED_SCHEDULE = {
  id: "schedule_1",
  enabled: true,
  timezone: "UTC",
  commitsPerDay: 1,
  daysOfWeek: ["MONDAY"],
  commitMessage: "chore: update GreenGrid activity",
  activityPath: ".greengrid/activity.json",
  lastRunAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  repository: {
    id: "repo_1",
    fullName: "gagan/activity-log",
    owner: "gagan",
    name: "activity-log",
    defaultBranch: "main",
    private: false,
    archived: false,
    canPush: true,
    htmlUrl: "https://github.com/gagan/activity-log",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOwnedSchedule", () => {
  it("scopes the lookup to the requesting user", async () => {
    scheduleFindFirst.mockResolvedValue(OWNED_SCHEDULE);

    await getOwnedSchedule("user_1", "schedule_1");

    expect(scheduleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "schedule_1", userId: "user_1" } }),
    );
  });

  it("reports NOT_FOUND — not FORBIDDEN — for another user's schedule", async () => {
    scheduleFindFirst.mockResolvedValue(null);

    await expect(getOwnedSchedule("attacker", "schedule_1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("derives nextRunAt rather than trusting stored state", async () => {
    scheduleFindFirst.mockResolvedValue(OWNED_SCHEDULE);
    const schedule = await getOwnedSchedule("user_1", "schedule_1");
    expect(schedule.nextRunAt).toBeInstanceOf(Date);
  });

  it("reports no next run for a paused schedule", async () => {
    scheduleFindFirst.mockResolvedValue({ ...OWNED_SCHEDULE, enabled: false });
    const schedule = await getOwnedSchedule("user_1", "schedule_1");
    expect(schedule.nextRunAt).toBeNull();
  });
});

describe("updateSchedule", () => {
  it("refuses to move a schedule onto a repository the user does not own", async () => {
    scheduleFindFirst.mockResolvedValue(OWNED_SCHEDULE);
    repositoryFindFirst.mockResolvedValue(null);

    await expect(
      updateSchedule("user_1", "schedule_1", { repositoryId: "someone-elses-repo" }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(scheduleUpdate).not.toHaveBeenCalled();
  });

  it("refuses an archived repository", async () => {
    scheduleFindFirst.mockResolvedValue(OWNED_SCHEDULE);
    repositoryFindFirst.mockResolvedValue({
      id: "repo_2",
      archived: true,
      canPush: true,
      defaultBranch: "main",
    });

    await expect(
      updateSchedule("user_1", "schedule_1", { repositoryId: "repo_2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a repository without push access", async () => {
    scheduleFindFirst.mockResolvedValue(OWNED_SCHEDULE);
    repositoryFindFirst.mockResolvedValue({
      id: "repo_2",
      archived: false,
      canPush: false,
      defaultBranch: "main",
    });

    await expect(
      updateSchedule("user_1", "schedule_1", { repositoryId: "repo_2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("only writes the fields that were supplied", async () => {
    scheduleFindFirst.mockResolvedValue(OWNED_SCHEDULE);
    scheduleUpdate.mockResolvedValue(OWNED_SCHEDULE);

    await updateSchedule("user_1", "schedule_1", { enabled: false });

    expect(scheduleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "schedule_1" }, data: { enabled: false } }),
    );
  });
});

describe("deleteSchedule", () => {
  it("deletes only within the caller's own rows", async () => {
    scheduleDeleteMany.mockResolvedValue({ count: 1 });

    await deleteSchedule("user_1", "schedule_1");

    expect(scheduleDeleteMany).toHaveBeenCalledWith({
      where: { id: "schedule_1", userId: "user_1" },
    });
  });

  it("throws NOT_FOUND when nothing matched", async () => {
    scheduleDeleteMany.mockResolvedValue({ count: 0 });

    await expect(deleteSchedule("attacker", "schedule_1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
