"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/lib/actions/action-state";
import { formFields, runAction } from "@/lib/actions/run-action";
import { authorize, enforceRateLimit } from "@/lib/api";
import { GITHUB_EVENT_TYPES, UPTIME_EVENT_TYPES } from "@/lib/hub/rules";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema } from "@/validators/automation";
import {
  addDiscordChannel,
  addEmailChannel,
  addSlackChannel,
  deleteChannel,
  testChannel,
} from "@/services/channel-service";
import { syncGitHubInstallations } from "@/services/github-webhook-service";
import { createRule, deleteRule, setRuleEnabled } from "@/services/notification-service";
import { createMonitor, deleteMonitor, setMonitorEnabled } from "@/services/uptime-service";
import "@/services/workflow-handlers";
import { retryRun } from "@/services/workflow-service";

/**
 * Notification hub mutations. Each action authenticates, authorizes,
 * rate-limits and validates on its own: Server Actions are public endpoints.
 */

const idSchema = z.object({ id: idParamSchema });
const toggleSchema = z.object({ id: idParamSchema, enabled: z.enum(["true", "false"]) });
const asArray = (value: unknown) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

async function hubUser() {
  const user = await authorize("notification:manage:own");
  await enforceRateLimit(`hub:write:${user.userId}`, RATE_LIMITS.automationWrite);
  return user;
}

function refresh() {
  revalidatePath("/notifications", "layout");
  revalidatePath("/settings/connections");
}

// ─── Channels ────────────────────────────────────────────────────────────────

const discordSchema = z.object({
  label: z.string().trim().min(1, "Give the channel a name").max(60),
  webhookUrl: z.string().trim().min(1).max(300),
});

export async function addDiscordChannelAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/discord", async () => {
    const user = await hubUser();
    await addDiscordChannel(user, discordSchema.parse(formFields(formData)));
    refresh();
    return "Discord channel added. A test message was posted.";
  });
}

const slackSchema = z.object({ target: z.string().regex(/^[A-Za-z0-9]{1,64}:[A-Z0-9]{5,20}$/, "Pick a channel") });

export async function addSlackChannelAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/slack", async () => {
    const user = await hubUser();
    const [slackIntegrationId, channelId] = slackSchema.parse(formFields(formData)).target.split(":") as [string, string];
    await addSlackChannel(user, { slackIntegrationId, channelId });
    refresh();
    return "Slack channel added.";
  });
}

const emailSchema = z.object({
  label: z.string().trim().max(60).default(""),
  to: z.string().trim().min(3).max(254),
});

export async function addEmailChannelAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/email", async () => {
    const user = await hubUser();
    await addEmailChannel(user, emailSchema.parse(formFields(formData)));
    refresh();
    return "Email channel added. A test email was sent from your Gmail.";
  });
}

export async function testChannelAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/channel-test", async () => {
    const user = await hubUser();
    await testChannel(user, idSchema.parse(formFields(formData)).id);
    refresh();
    return "Test message sent.";
  });
}

export async function deleteChannelAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/channel-delete", async () => {
    const user = await hubUser();
    await deleteChannel(user, idSchema.parse(formFields(formData)).id);
    refresh();
    return "Channel removed.";
  });
}

// ─── Rules ───────────────────────────────────────────────────────────────────

const githubRuleSchema = z.object({
  name: z.string().trim().min(1, "Name the rule").max(80),
  events: z.array(z.enum(GITHUB_EVENT_TYPES)).min(1, "Pick at least one event"),
  repositories: z
    .string()
    .max(2_000)
    .default("")
    .transform((value) =>
      value
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  channelIds: z.array(idParamSchema).min(1, "Pick at least one channel"),
});

export async function createGitHubRuleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/rule-github", async () => {
    const user = await hubUser();
    const fields = formFields(formData);
    const input = githubRuleSchema.parse({ ...fields, events: asArray(fields.events), channelIds: asArray(fields.channelIds) });
    await createRule(user, {
      name: input.name,
      source: "GITHUB",
      filter: { events: input.events, repositories: input.repositories },
      channelIds: input.channelIds,
    });
    refresh();
    return "Rule created.";
  });
}

const uptimeRuleSchema = z.object({
  name: z.string().trim().min(1, "Name the rule").max(80),
  events: z.array(z.enum(UPTIME_EVENT_TYPES)).min(1, "Pick at least one event"),
  monitorIds: z.array(idParamSchema).default([]),
  channelIds: z.array(idParamSchema).min(1, "Pick at least one channel"),
});

export async function createUptimeRuleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/rule-uptime", async () => {
    const user = await hubUser();
    const fields = formFields(formData);
    const input = uptimeRuleSchema.parse({
      ...fields,
      events: asArray(fields.events),
      monitorIds: asArray(fields.monitorIds),
      channelIds: asArray(fields.channelIds),
    });
    await createRule(user, {
      name: input.name,
      source: "UPTIME",
      filter: { events: input.events, monitorIds: input.monitorIds },
      channelIds: input.channelIds,
    });
    refresh();
    return "Rule created.";
  });
}

export async function toggleRuleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/rule-toggle", async () => {
    const user = await hubUser();
    const { id, enabled } = toggleSchema.parse(formFields(formData));
    await setRuleEnabled(user, id, enabled === "true");
    refresh();
    return enabled === "true" ? "Rule turned on." : "Rule paused.";
  });
}

export async function deleteRuleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/rule-delete", async () => {
    const user = await hubUser();
    await deleteRule(user, idSchema.parse(formFields(formData)).id);
    refresh();
    return "Rule deleted.";
  });
}

// ─── Uptime monitors ─────────────────────────────────────────────────────────

export async function createMonitorAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/monitor-create", async () => {
    const user = await hubUser();
    await createMonitor(user, formFields(formData));
    refresh();
    return "Monitor added. The first check runs within 15 minutes.";
  });
}

export async function toggleMonitorAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/monitor-toggle", async () => {
    const user = await hubUser();
    const { id, enabled } = toggleSchema.parse(formFields(formData));
    await setMonitorEnabled(user, id, enabled === "true");
    refresh();
    return enabled === "true" ? "Monitor resumed." : "Monitor paused.";
  });
}

export async function deleteMonitorAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/monitor-delete", async () => {
    const user = await hubUser();
    await deleteMonitor(user, idSchema.parse(formFields(formData)).id);
    refresh();
    return "Monitor deleted.";
  });
}

// ─── GitHub App and runs ─────────────────────────────────────────────────────

export async function syncGitHubInstallationsAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  return runAction("action:hub/github-sync", async () => {
    const user = await authorize("integration:github:manage:own");
    await enforceRateLimit(`hub:github-sync:${user.userId}`, RATE_LIMITS.integrationConnect);
    const linked = await syncGitHubInstallations(user.userId);
    refresh();
    return linked > 0 ? `Linked ${linked} GitHub App installation${linked === 1 ? "" : "s"}.` : "No new installations found.";
  });
}

export async function retryRunAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:hub/run-retry", async () => {
    const user = await hubUser();
    const { id } = idSchema.parse(formFields(formData));
    await retryRun(user.userId, id);
    revalidatePath(`/notifications/runs/${id}`);
    return "Queued for retry. It will be delivered within 15 minutes.";
  });
}
