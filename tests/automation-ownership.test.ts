import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/lib/rbac";

const automationFindUnique = vi.fn();
const automationFindFirst = vi.fn();
const automationUpdate = vi.fn();
const automationDelete = vi.fn();
const executionFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    automation: {
      findUnique: (...args: unknown[]) => automationFindUnique(...args),
      findFirst: (...args: unknown[]) => automationFindFirst(...args),
      update: (...args: unknown[]) => automationUpdate(...args),
      delete: (...args: unknown[]) => automationDelete(...args),
    },
    execution: { findUnique: (...args: unknown[]) => executionFindUnique(...args) },
    auditLog: { create: vi.fn() },
  },
}));

// Provider services are never reached by ownership checks.
vi.mock("@/services/github-service", () => ({ verifySources: vi.fn(), fetchCommitsForSources: vi.fn(), createGitHubPort: vi.fn() }));
vi.mock("@/services/slack-service", () => ({ checkChannelAccess: vi.fn(), createSlackPort: vi.fn() }));
vi.mock("@/services/ai-service", () => ({ generateStandupSummary: vi.fn(), createAiPort: vi.fn() }));

const { getAutomationForActor, updateAutomation, deleteAutomation, setAutomationPaused, adminSetAutomationDisabled } =
  await import("@/services/automation-service");
const { getExecutionForActor } = await import("@/services/execution-service");

const alice: Actor = { userId: "alice", role: "USER", status: "ACTIVE" };
const bob: Actor = { userId: "bob", role: "USER", status: "ACTIVE" };
const admin: Actor = { userId: "root", role: "ADMIN", status: "ACTIVE" };

const ALICE_AUTOMATION = {
  id: "auto_alice",
  userId: "alice",
  name: "Alice standup",
  status: "ACTIVE",
  disabledReason: null,
  githubSources: [{ repositoryId: "1", owner: "acme", name: "api", branch: null }],
  commitWindow: "SAME_DAY",
  slackIntegrationId: "slack_alice",
  slackChannelId: "C123456",
  slackChannelName: "standups",
  postingMode: "BOT",
  messageStyle: "CONCISE",
  quickNote: null,
  includeFileStats: false,
  threadMode: "DATE_HEADER",
  headerFormat: "📅 {date}",
  daysOfWeek: ["MONDAY"],
  scheduleTimes: ["17:00"],
  timezone: "Asia/Kolkata",
  lastExecutionAt: null,
  createdAt: new Date("2026-09-01"),
  updatedAt: new Date("2026-09-01"),
  slackIntegration: { teamName: "Acme", status: "CONNECTED" },
  user: { githubIntegration: { status: "CONNECTED" } },
  executions: [],
};

/** Mimics Postgres: findFirst honours the { id, userId } filter. */
function scopedFindFirst(args: { where: { id: string; userId: string } }) {
  return args.where.id === ALICE_AUTOMATION.id && args.where.userId === ALICE_AUTOMATION.userId ? ALICE_AUTOMATION : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  automationFindUnique.mockResolvedValue(ALICE_AUTOMATION);
  automationFindFirst.mockImplementation(async (args) => scopedFindFirst(args));
});

describe("two users cannot access each other's automations", () => {
  it("the owner can read it", async () => {
    await expect(getAutomationForActor(alice, "auto_alice")).resolves.toMatchObject({ id: "auto_alice" });
  });

  it("another user reading by ID gets NOT_FOUND", async () => {
    await expect(getAutomationForActor(bob, "auto_alice")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("another user cannot update, pause or delete it — the lookup is scoped by owner", async () => {
    await expect(updateAutomation(bob, "auto_alice", { name: "pwned" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setAutomationPaused(bob, "auto_alice", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteAutomation(bob, "auto_alice")).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(automationFindFirst).toHaveBeenCalledWith({ where: { id: "auto_alice", userId: "bob" } });
    expect(automationUpdate).not.toHaveBeenCalled();
    expect(automationDelete).not.toHaveBeenCalled();
  });

  it("the owner can pause and delete", async () => {
    await setAutomationPaused(alice, "auto_alice", true);
    expect(automationUpdate).toHaveBeenCalledWith({ where: { id: "auto_alice" }, data: { status: "PAUSED" } });
    await deleteAutomation(alice, "auto_alice");
    expect(automationDelete).toHaveBeenCalledWith({ where: { id: "auto_alice" } });
  });

  it("an owner cannot resume an automation an admin disabled", async () => {
    automationFindFirst.mockResolvedValue({ ...ALICE_AUTOMATION, status: "DISABLED" });
    await expect(setAutomationPaused(alice, "auto_alice", false)).rejects.toMatchObject({ code: "AUTOMATION_NOT_ACTIVE" });
  });

  it("another user cannot read the automation's executions", async () => {
    executionFindUnique.mockResolvedValue({ id: "exec_1", userId: "alice" });
    await expect(getExecutionForActor(bob, "exec_1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getExecutionForActor(alice, "exec_1")).resolves.toMatchObject({ id: "exec_1" });
  });
});

describe("admin access to automations", () => {
  it("admins can read any automation and execution", async () => {
    await expect(getAutomationForActor(admin, "auto_alice")).resolves.toMatchObject({ userId: "alice" });
    executionFindUnique.mockResolvedValue({ id: "exec_1", userId: "alice" });
    await expect(getExecutionForActor(admin, "exec_1")).resolves.toMatchObject({ id: "exec_1" });
  });

  it("admins cannot edit or delete another user's automation", async () => {
    await expect(updateAutomation(admin, "auto_alice", { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteAutomation(admin, "auto_alice")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("only admins can disable an automation", async () => {
    await expect(adminSetAutomationDisabled(alice, "auto_alice", true, null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await adminSetAutomationDisabled(admin, "auto_alice", true, "abuse");
    expect(automationUpdate).toHaveBeenCalledWith({
      where: { id: "auto_alice" },
      data: { status: "DISABLED", disabledReason: "abuse" },
    });
  });
});
