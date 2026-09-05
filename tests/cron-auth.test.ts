import { beforeEach, describe, expect, it, vi } from "vitest";

const CRON_SECRET = "test-cron-secret-value-1234567890";

const runScheduledActivity = vi.fn();
const findManySchedules = vi.fn();

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ CRON_SECRET }),
  getAppUrl: () => "http://localhost:3000",
  isProduction: () => false,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    schedule: { findMany: (...args: unknown[]) => findManySchedules(...args) },
  },
}));

vi.mock("@/lib/activity/run-activity", () => ({
  runScheduledActivity: (...args: unknown[]) => runScheduledActivity(...args),
}));

vi.mock("@/lib/session", () => ({
  pruneExpiredSessions: async () => 0,
}));

const { POST } = await import("@/app/api/cron/activity/route");

type CronRequest = Parameters<typeof POST>[0];

function request(authorization?: string): CronRequest {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return { headers } as unknown as CronRequest;
}

/** A weekday 09:00 Kolkata schedule; 03:30 UTC on 2026-09-01 is its slot. */
const DUE_SCHEDULE = {
  id: "schedule_1",
  timezone: "Asia/Kolkata",
  commitsPerDay: 1,
  daysOfWeek: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-01T03:35:00Z"));
  runScheduledActivity.mockReset();
  findManySchedules.mockReset();
  findManySchedules.mockResolvedValue([]);
});

describe("cron authentication", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(runScheduledActivity).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    const response = await POST(request("Bearer wrong-secret-value-000000000"));
    expect(response.status).toBe(401);
  });

  it("rejects a non-Bearer scheme", async () => {
    const response = await POST(request("Basic " + CRON_SECRET));
    expect(response.status).toBe(401);
  });

  it("accepts the configured secret", async () => {
    const response = await POST(request("Bearer " + CRON_SECRET));
    expect(response.status).toBe(200);
  });

  it("accepts a case-insensitive bearer scheme", async () => {
    const response = await POST(request("bearer " + CRON_SECRET));
    expect(response.status).toBe(200);
  });
});

describe("cron batch processing", () => {
  it("summarises successes, skips and failures", async () => {
    findManySchedules.mockResolvedValue([
      { ...DUE_SCHEDULE, id: "a" },
      { ...DUE_SCHEDULE, id: "b" },
      { ...DUE_SCHEDULE, id: "c" },
    ]);

    runScheduledActivity
      .mockResolvedValueOnce({ status: "COMPLETED" })
      .mockResolvedValueOnce({ status: "SKIPPED" })
      .mockResolvedValueOnce({ status: "FAILED" });

    const response = await POST(request("Bearer " + CRON_SECRET));
    await expect(response.json()).resolves.toEqual({
      processed: 3,
      successful: 1,
      skipped: 1,
      failed: 1,
    });
  });

  it("does not let one failing schedule abort the batch", async () => {
    findManySchedules.mockResolvedValue([
      { ...DUE_SCHEDULE, id: "a" },
      { ...DUE_SCHEDULE, id: "b" },
    ]);

    runScheduledActivity
      .mockRejectedValueOnce(new Error("GitHub exploded"))
      .mockResolvedValueOnce({ status: "COMPLETED" });

    const response = await POST(request("Bearer " + CRON_SECRET));
    await expect(response.json()).resolves.toMatchObject({
      processed: 2,
      successful: 1,
      failed: 1,
    });
  });

  it("skips schedules that are not due right now", async () => {
    vi.setSystemTime(new Date("2026-09-01T01:00:00Z")); // before 09:00 local
    findManySchedules.mockResolvedValue([DUE_SCHEDULE]);

    const response = await POST(request("Bearer " + CRON_SECRET));
    await expect(response.json()).resolves.toMatchObject({ processed: 0 });
    expect(runScheduledActivity).not.toHaveBeenCalled();
  });

  it("passes the local day key to the runner for idempotency", async () => {
    findManySchedules.mockResolvedValue([DUE_SCHEDULE]);
    runScheduledActivity.mockResolvedValue({ status: "COMPLETED" });

    await POST(request("Bearer " + CRON_SECRET));

    expect(runScheduledActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: "schedule_1",
        trigger: "SCHEDULED",
        dayKey: "2026-09-01",
        slotIndex: 0,
      }),
    );
  });

  it("processes every due slot when several are pending", async () => {
    vi.setSystemTime(new Date("2026-09-01T04:50:00Z")); // 10:20 IST
    findManySchedules.mockResolvedValue([{ ...DUE_SCHEDULE, commitsPerDay: 5 }]);
    runScheduledActivity.mockResolvedValue({ status: "COMPLETED" });

    const response = await POST(request("Bearer " + CRON_SECRET));

    await expect(response.json()).resolves.toMatchObject({ processed: 2, successful: 2 });
    expect(runScheduledActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ slotIndex: 0 }),
    );
    expect(runScheduledActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ slotIndex: 1 }),
    );
  });
});
