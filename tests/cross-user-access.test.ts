import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/lib/rbac";
import { scopedModel } from "./helpers/scoped-prisma";

/**
 * Broken object-level authorization: for every resource a user owns, another
 * user who knows the id gets "not found" and nothing is read or changed.
 */

const db = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof import("./helpers/scoped-prisma").scopedModel>>);

vi.mock("@/lib/db", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_target, model: string) => {
        if (model === "$transaction") return async (ops: Array<Promise<unknown>>) => Promise.all(ops);
        if (model === "auditLog") return { create: async () => ({}) };
        return db[model];
      },
    },
  ),
}));

const alice: Actor = { userId: "alice", role: "USER", status: "ACTIVE" };
const bob: Actor = { userId: "bob", role: "USER", status: "ACTIVE" };

beforeEach(() => {
  db.notificationChannel = scopedModel([
    { id: "chan_a", userId: "alice", kind: "DISCORD_WEBHOOK", label: "alerts", configEncrypted: "x", verified: true },
  ]);
  db.notificationRule = scopedModel([{ id: "rule_a", userId: "alice", enabled: true }]);
  db.uptimeMonitor = scopedModel([{ id: "mon_a", userId: "alice", enabled: true }]);
  db.workflowRun = scopedModel([{ id: "run_a", userId: "alice", status: "FAILED", input: { message: {} } }]);
  db.workflowStep = scopedModel([]);
  db.instagramAutomation = scopedModel([{ id: "ig_a", userId: "alice", status: "ACTIVE" }]);
  db.instagramIntegration = scopedModel([{ id: "igi_a", userId: "alice", username: "alice", accessTokenEncrypted: null }]);
  db.slackIntegration = scopedModel([{ id: "sl_a", userId: "alice", teamId: "T1", botTokenEncrypted: null, userTokenEncrypted: null }]);
});

describe("notification hub resources", () => {
  it("channels: another user cannot test or delete them", async () => {
    const { deleteChannel, testChannel } = await import("@/services/channel-service");
    await expect(testChannel(bob, "chan_a")).rejects.toThrow();
    await expect(deleteChannel(bob, "chan_a")).rejects.toMatchObject({ userMessage: "That channel was not found." });
    expect(db.notificationChannel!.rows).toHaveLength(1);
    await deleteChannel(alice, "chan_a");
    expect(db.notificationChannel!.rows).toHaveLength(0);
  });

  it("rules: another user cannot pause or delete them", async () => {
    const { deleteRule, setRuleEnabled } = await import("@/services/notification-service");
    await expect(setRuleEnabled(bob, "rule_a", false)).rejects.toMatchObject({ userMessage: "That rule was not found." });
    await expect(deleteRule(bob, "rule_a")).rejects.toMatchObject({ userMessage: "That rule was not found." });
    expect(db.notificationRule!.rows[0]).toMatchObject({ enabled: true });
    await setRuleEnabled(alice, "rule_a", false);
    expect(db.notificationRule!.rows[0]).toMatchObject({ enabled: false });
  });

  it("uptime monitors: another user cannot pause or delete them", async () => {
    const { deleteMonitor, setMonitorEnabled } = await import("@/services/uptime-service");
    await expect(setMonitorEnabled(bob, "mon_a", false)).rejects.toMatchObject({ userMessage: "That monitor was not found." });
    await expect(deleteMonitor(bob, "mon_a")).rejects.toMatchObject({ userMessage: "That monitor was not found." });
    expect(db.uptimeMonitor!.rows[0]).toMatchObject({ enabled: true });
    await setMonitorEnabled(alice, "mon_a", false);
    expect(db.uptimeMonitor!.rows[0]).toMatchObject({ enabled: false });
  });

  it("runs: another user can neither read nor retry them", async () => {
    const { getRunForUser } = await import("@/services/notification-service");
    const { retryRun } = await import("@/services/workflow-service");
    await expect(getRunForUser("bob", "run_a")).resolves.toBeNull();
    await expect(retryRun("bob", "run_a")).rejects.toMatchObject({ userMessage: "That run was not found." });
    expect(db.workflowRun!.rows[0]).toMatchObject({ status: "FAILED" });
    await expect(getRunForUser("alice", "run_a")).resolves.toMatchObject({ id: "run_a" });
  });
});

describe("instagram and slack", () => {
  it("instagram automations: another user gets NOT_FOUND", async () => {
    const { getInstagramAutomation, deleteInstagramAutomation } = await import("@/services/instagram-automation-service");
    await expect(getInstagramAutomation(bob, "ig_a")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteInstagramAutomation(bob, "ig_a")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.instagramAutomation!.rows).toHaveLength(1);
    await expect(getInstagramAutomation(alice, "ig_a")).resolves.toMatchObject({ id: "ig_a" });
  });

  it("integrations: another user cannot disconnect them", async () => {
    const { disconnectInstagram } = await import("@/services/instagram-service");
    const { disconnectSlack } = await import("@/services/slack-service");
    await expect(disconnectInstagram("bob", "igi_a")).rejects.toMatchObject({ code: "INSTAGRAM_NOT_CONNECTED" });
    await expect(disconnectSlack("bob", "sl_a")).rejects.toMatchObject({ code: "SLACK_NOT_CONNECTED" });
    expect(db.instagramIntegration!.rows[0]).not.toHaveProperty("status");
    expect(db.slackIntegration!.rows[0]).not.toHaveProperty("status");
  });
});
