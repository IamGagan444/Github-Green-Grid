import { beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubApiError } from "@/lib/github/errors";

const scheduleFindUnique = vi.fn();
const executionCreate = vi.fn();
const executionUpdate = vi.fn();
const transaction = vi.fn();

const getGitHubClient = vi.fn();
const checkRepositoryWritable = vi.fn();
const getActivityFile = vi.fn();
const commitFile = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    schedule: {
      findUnique: (...args: unknown[]) => scheduleFindUnique(...args),
      update: vi.fn(),
    },
    activityExecution: {
      create: (...args: unknown[]) => executionCreate(...args),
      update: (...args: unknown[]) => executionUpdate(...args),
    },
    repository: { update: vi.fn() },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

vi.mock("@/lib/github", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/github-content")>(
    "@/lib/github/github-content",
  );
  const errors = await vi.importActual<typeof import("@/lib/github/errors")>(
    "@/lib/github/errors",
  );

  return {
    ...errors,
    advanceActivityFile: actual.advanceActivityFile,
    serialiseActivityFile: actual.serialiseActivityFile,
    createInitialActivityFile: actual.createInitialActivityFile,
    getGitHubClient: (...args: unknown[]) => getGitHubClient(...args),
    checkRepositoryWritable: (...args: unknown[]) => checkRepositoryWritable(...args),
    getActivityFile: (...args: unknown[]) => getActivityFile(...args),
    commitFile: (...args: unknown[]) => commitFile(...args),
  };
});

const { runScheduledActivity } = await import("@/lib/activity/run-activity");

const SCHEDULE = {
  id: "schedule_1",
  userId: "user_1",
  enabled: true,
  timezone: "UTC",
  commitsPerDay: 1,
  commitMessage: "chore: update GreenGrid activity",
  activityPath: ".greengrid/activity.json",
  repository: {
    id: "repo_1",
    owner: "gagan",
    name: "activity-log",
    fullName: "gagan/activity-log",
    defaultBranch: "main",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  scheduleFindUnique.mockResolvedValue(SCHEDULE);
  executionCreate.mockResolvedValue({ id: "execution_1" });
  executionUpdate.mockResolvedValue({});
  transaction.mockResolvedValue([]);
  getGitHubClient.mockResolvedValue({});
  checkRepositoryWritable.mockResolvedValue({ writable: true, defaultBranch: "main" });
  getActivityFile.mockResolvedValue({
    contents: { version: 1, lastActivity: "2026-08-31", runs: 42, history: [] },
    sha: "blob-sha",
  });
  commitFile.mockResolvedValue({
    sha: "commit-sha",
    url: "https://github.com/gagan/activity-log/commit/commit-sha",
    message: "chore: update GreenGrid activity",
  });
});

describe("runScheduledActivity", () => {
  it("creates exactly one commit for a successful run", async () => {
    const outcome = await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "SCHEDULED",
      dayKey: "2026-09-01",
    });

    expect(commitFile).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status === "COMPLETED") {
      expect(outcome.commitSha).toBe("commit-sha");
    }
  });

  it("increments the run counter in the committed file", async () => {
    await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "SCHEDULED",
      dayKey: "2026-09-01",
    });

    const call = commitFile.mock.calls[0]?.[1] as { content: string; sha: string | null };
    expect(JSON.parse(call.content)).toMatchObject({ runs: 43, lastActivity: "2026-09-01" });
    expect(call.sha).toBe("blob-sha");
  });

  it("records an idempotency key for scheduled runs but not manual ones", async () => {
    await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "SCHEDULED",
      dayKey: "2026-09-01",
    });
    const scheduled = executionCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(scheduled.data.idempotencyKey).toBe("schedule_1:2026-09-01:0");

    executionCreate.mockClear();

    await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "MANUAL",
      dayKey: "2026-09-01",
    });
    const manual = executionCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(manual.data.idempotencyKey).toBeNull();
  });

  it("gives each slot of the day its own idempotency key", async () => {
    await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "SCHEDULED",
      dayKey: "2026-09-01",
      slotIndex: 7,
    });

    const created = executionCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(created.data.idempotencyKey).toBe("schedule_1:2026-09-01:7");
    expect(created.data.scheduledDay).toBe("2026-09-01");
  });

  it("skips a duplicate scheduled run for the same day and slot", async () => {
    executionCreate.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));

    const outcome = await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "SCHEDULED",
      dayKey: "2026-09-01",
    });

    expect(outcome.status).toBe("SKIPPED");
    expect(commitFile).not.toHaveBeenCalled();
  });

  it("skips scheduled runs for a paused schedule", async () => {
    scheduleFindUnique.mockResolvedValue({ ...SCHEDULE, enabled: false });

    const outcome = await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "SCHEDULED",
      dayKey: "2026-09-01",
    });

    expect(outcome.status).toBe("SKIPPED");
    expect(executionCreate).not.toHaveBeenCalled();
  });

  it("still allows a manual run while a schedule is paused", async () => {
    scheduleFindUnique.mockResolvedValue({ ...SCHEDULE, enabled: false });

    const outcome = await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "MANUAL",
      dayKey: "2026-09-01",
    });

    expect(outcome.status).toBe("COMPLETED");
  });

  it("fails without committing when write access was revoked", async () => {
    checkRepositoryWritable.mockResolvedValue({
      writable: false,
      reason: "GreenGrid does not have write access to this repository.",
    });

    const outcome = await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "SCHEDULED",
      dayKey: "2026-09-01",
    });

    expect(outcome.status).toBe("FAILED");
    expect(commitFile).not.toHaveBeenCalled();
  });

  it("clears the idempotency key so a rate-limited run can retry", async () => {
    commitFile.mockRejectedValue(new GitHubApiError("RATE_LIMITED", 429, "rate limited"));

    const outcome = await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "SCHEDULED",
      dayKey: "2026-09-01",
    });

    expect(outcome.status).toBe("FAILED");
    if (outcome.status === "FAILED") expect(outcome.retryable).toBe(true);

    const update = executionUpdate.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
    expect(update.data.idempotencyKey).toBeNull();
  });

  it("keeps the idempotency key for a permanent failure", async () => {
    commitFile.mockRejectedValue(new GitHubApiError("FORBIDDEN", 403, "forbidden"));

    await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "SCHEDULED",
      dayKey: "2026-09-01",
    });

    const update = executionUpdate.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
    expect(update.data).not.toHaveProperty("idempotencyKey");
  });

  it("surfaces a user-safe message, never the internal detail", async () => {
    commitFile.mockRejectedValue(
      new GitHubApiError("UNAUTHORIZED", 401, "token ghp_secret rejected"),
    );

    const outcome = await runScheduledActivity({
      scheduleId: "schedule_1",
      trigger: "SCHEDULED",
      dayKey: "2026-09-01",
    });

    expect(outcome.status).toBe("FAILED");
    if (outcome.status === "FAILED") {
      expect(outcome.reason).toBe("Your GitHub connection needs to be renewed.");
      expect(outcome.reason).not.toContain("ghp_");
    }
  });

  it("fails cleanly when the schedule does not exist", async () => {
    scheduleFindUnique.mockResolvedValue(null);

    const outcome = await runScheduledActivity({
      scheduleId: "missing",
      trigger: "MANUAL",
    });

    expect(outcome.status).toBe("FAILED");
  });
});
