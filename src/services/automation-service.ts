import "server-only";

import { ZodError } from "zod";

import { commitWindow, getNextRun, localDayKey, normaliseScheduleTimes } from "@/lib/automation/schedule";
import type { AutomationSnapshot } from "@/lib/automation/types";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertPermission, assertResourceAccess, AuthorizationError, type Actor } from "@/lib/rbac";
import { buildAiParent, buildDateHeader, buildUpdateMessage, formatLongDate } from "@/lib/slack/message";
import { TEST_EVENT_TYPE } from "@/lib/slack/types";
import type { Automation, Prisma } from "@/generated/prisma/client";
import type { AutomationStatus } from "@/generated/prisma/enums";
import {
  parseStoredSources,
  scheduleTimesProblem,
  type AutomationConfig,
  type GitHubSource,
  type PreviewAutomationInput,
} from "@/validators/automation";
import { recordAudit } from "@/services/audit-service";
import { generateStandupSummary } from "@/services/ai-service";
import { fetchCommitsForSources, verifySources } from "@/services/github-service";
import { checkChannelAccess, createSlackPort } from "@/services/slack-service";

export function toSnapshot(record: Automation): AutomationSnapshot {
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    status: record.status,
    githubSources: parseStoredSources(record.githubSources),
    commitWindow: record.commitWindow,
    slackIntegrationId: record.slackIntegrationId,
    slackChannelId: record.slackChannelId,
    slackChannelName: record.slackChannelName,
    postingMode: record.postingMode,
    messageStyle: record.messageStyle,
    quickNote: record.quickNote,
    includeFileStats: record.includeFileStats,
    threadMode: record.threadMode,
    headerFormat: record.headerFormat,
    timezone: record.timezone,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read models
// ─────────────────────────────────────────────────────────────────────────────

export interface AutomationSummary {
  id: string;
  userId: string;
  name: string;
  status: AutomationStatus;
  disabledReason: string | null;
  githubSources: GitHubSource[];
  commitWindow: AutomationConfig["commitWindow"];
  slackIntegrationId: string | null;
  slackTeamName: string | null;
  slackChannelId: string;
  slackChannelName: string;
  postingMode: AutomationConfig["postingMode"];
  messageStyle: AutomationConfig["messageStyle"];
  quickNote: string | null;
  includeFileStats: boolean;
  threadMode: AutomationConfig["threadMode"];
  headerFormat: string;
  daysOfWeek: AutomationConfig["daysOfWeek"];
  scheduleTimes: string[];
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  nextRunAt: Date | null;
  lastExecution: {
    id: string;
    status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
    executionDate: string;
    startedAt: Date;
    errorMessage: string | null;
  } | null;
  /** Human-readable reasons this automation cannot currently run. */
  blockers: string[];
}

const summaryInclude = {
  slackIntegration: { select: { teamName: true, status: true } },
  user: { select: { githubIntegration: { select: { status: true } } } },
  executions: {
    orderBy: { startedAt: "desc" as const },
    take: 1,
    select: { id: true, status: true, executionDate: true, slot: true, startedAt: true, errorMessage: true },
  },
} satisfies Prisma.AutomationInclude;

type AutomationWithRelations = Prisma.AutomationGetPayload<{ include: typeof summaryInclude }>;

function toSummary(record: AutomationWithRelations): AutomationSummary {
  const blockers: string[] = [];
  const githubStatus = record.user.githubIntegration?.status;
  if (githubStatus !== "CONNECTED") blockers.push("GitHub is not connected.");
  if (!record.slackIntegration) blockers.push("Slack workspace was removed.");
  else if (record.slackIntegration.status !== "CONNECTED") blockers.push("Slack is not connected.");
  if (record.status === "DISABLED") blockers.push(record.disabledReason ?? "Disabled by an administrator.");

  const timing = { daysOfWeek: record.daysOfWeek, scheduleTimes: record.scheduleTimes, timezone: record.timezone };
  let next = record.status === "ACTIVE" && blockers.length === 0 ? getNextRun(timing) : null;
  // A slot already posted early (Run now in "previous day" mode) will not post again.
  const last = record.executions[0];
  if (
    next &&
    last?.executionDate === next.executionDate &&
    last.slot === next.slot &&
    (last.status === "SUCCESS" || last.status === "SKIPPED")
  ) {
    next = getNextRun(timing, new Date(next.scheduledFor.getTime() + 1));
  }

  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    status: record.status,
    disabledReason: record.disabledReason,
    githubSources: parseStoredSources(record.githubSources),
    commitWindow: record.commitWindow,
    slackIntegrationId: record.slackIntegrationId,
    slackTeamName: record.slackIntegration?.teamName ?? null,
    slackChannelId: record.slackChannelId,
    slackChannelName: record.slackChannelName,
    postingMode: record.postingMode,
    messageStyle: record.messageStyle,
    quickNote: record.quickNote,
    includeFileStats: record.includeFileStats,
    threadMode: record.threadMode,
    headerFormat: record.headerFormat,
    daysOfWeek: record.daysOfWeek,
    scheduleTimes: record.scheduleTimes,
    timezone: record.timezone,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nextRunAt: next?.scheduledFor ?? null,
    lastExecution: record.executions[0] ?? null,
    blockers,
  };
}

export async function listAutomationsForUser(userId: string): Promise<AutomationSummary[]> {
  const records = await prisma.automation.findMany({
    where: { userId },
    include: summaryInclude,
    orderBy: { createdAt: "desc" },
  });
  return records.map(toSummary);
}

export async function listAllAutomations(options: { status?: AutomationStatus; page: number; pageSize: number }) {
  const where: Prisma.AutomationWhereInput = options.status ? { status: options.status } : {};
  const [records, total] = await Promise.all([
    prisma.automation.findMany({
      where,
      include: { ...summaryInclude, user: { select: { name: true, email: true, githubIntegration: { select: { status: true } } } } },
      orderBy: { createdAt: "desc" },
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
    prisma.automation.count({ where }),
  ]);
  return {
    items: records.map((record) => ({ ...toSummary(record), owner: { name: record.user.name, email: record.user.email } })),
    total,
  };
}

/**
 * Loads one automation for `actor`. Owners see their own; admins may read any.
 * Anything else is NOT_FOUND — IDs cannot be probed.
 */
export async function getAutomationForActor(actor: Actor, automationId: string): Promise<AutomationSummary> {
  const record = await prisma.automation.findUnique({ where: { id: automationId }, include: summaryInclude });
  if (!record) throw new AuthorizationError("NOT_FOUND");
  assertResourceAccess(actor, record.userId, "automation:read:own", "automation:read:all");
  return toSummary(record);
}

/** Mutations are owner-only: the lookup itself is scoped by userId. */
async function getOwnedRecord(actor: Actor, automationId: string): Promise<Automation> {
  const record = await prisma.automation.findFirst({ where: { id: automationId, userId: actor.userId } });
  if (!record) throw new AuthorizationError("NOT_FOUND");
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation against live integrations
// ─────────────────────────────────────────────────────────────────────────────

async function validateSlackTarget(
  userId: string,
  config: Pick<AutomationConfig, "slackIntegrationId" | "slackChannelId" | "postingMode">,
) {
  const integration = await prisma.slackIntegration.findFirst({
    where: { id: config.slackIntegrationId, userId },
    select: { id: true, status: true, userTokenEncrypted: true, userScopes: true },
  });
  if (!integration) throw new AuthorizationError("NOT_FOUND", "That Slack workspace is not connected to your account.");
  if (integration.status !== "CONNECTED") throw new AppError("SLACK_NOT_CONNECTED");
  if (config.postingMode === "USER" && (!integration.userTokenEncrypted || !integration.userScopes.includes("chat:write"))) {
    throw new AppError("SLACK_USER_POSTING_UNAVAILABLE");
  }
  return checkChannelAccess(userId, integration.id, config.slackChannelId, config.postingMode);
}

function toData(config: AutomationConfig, channelName: string) {
  return {
    name: config.name,
    githubSources: config.githubSources as unknown as Prisma.InputJsonValue,
    commitWindow: config.commitWindow,
    messageStyle: config.messageStyle,
    quickNote: config.quickNote,
    includeFileStats: config.includeFileStats,
    slackIntegrationId: config.slackIntegrationId,
    slackChannelId: config.slackChannelId,
    // The channel name comes from Slack, not from the client.
    slackChannelName: channelName,
    postingMode: config.postingMode,
    threadMode: config.threadMode,
    headerFormat: config.headerFormat,
    daysOfWeek: config.daysOfWeek,
    scheduleTimes: normaliseScheduleTimes(config.scheduleTimes),
    timezone: config.timezone,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export async function createAutomation(actor: Actor, config: AutomationConfig, activate: boolean) {
  assertPermission(actor, "automation:create:own");

  await verifySources(actor.userId, config.githubSources);
  const channel = await validateSlackTarget(actor.userId, config);

  const created = await prisma.automation.create({
    data: { ...toData(config, channel.name), userId: actor.userId, status: activate ? "ACTIVE" : "PAUSED" },
    select: { id: true },
  });

  await recordAudit({
    actorUserId: actor.userId,
    action: "AUTOMATION_CREATED",
    targetType: "Automation",
    targetId: created.id,
    metadata: { name: config.name, repositories: config.githubSources.map((source) => source.fullName) },
  });
  return created;
}

export async function updateAutomation(actor: Actor, automationId: string, patch: Partial<AutomationConfig>) {
  assertPermission(actor, "automation:update:own");
  const record = await getOwnedRecord(actor, automationId);
  const current = toSnapshot(record);

  const merged: AutomationConfig = {
    name: patch.name ?? record.name,
    githubSources: patch.githubSources ?? current.githubSources,
    commitWindow: patch.commitWindow ?? record.commitWindow,
    messageStyle: patch.messageStyle ?? record.messageStyle,
    quickNote: patch.quickNote !== undefined ? patch.quickNote : record.quickNote,
    includeFileStats: patch.includeFileStats ?? record.includeFileStats,
    slackIntegrationId: patch.slackIntegrationId ?? record.slackIntegrationId ?? "",
    slackChannelId: patch.slackChannelId ?? record.slackChannelId,
    slackChannelName: patch.slackChannelName ?? record.slackChannelName,
    postingMode: patch.postingMode ?? record.postingMode,
    threadMode: patch.threadMode ?? record.threadMode,
    headerFormat: patch.headerFormat ?? record.headerFormat,
    daysOfWeek: patch.daysOfWeek ?? record.daysOfWeek,
    scheduleTimes: patch.scheduleTimes ?? record.scheduleTimes,
    timezone: patch.timezone ?? record.timezone,
  };

  const scheduleProblem = scheduleTimesProblem(merged.commitWindow, merged.scheduleTimes);
  if (scheduleProblem) {
    throw new ZodError([{ code: "custom", path: ["scheduleTimes"], message: scheduleProblem, input: merged.scheduleTimes }]);
  }

  if (patch.githubSources) await verifySources(actor.userId, merged.githubSources);

  let channelName = record.slackChannelName;
  if (patch.slackIntegrationId || patch.slackChannelId || patch.postingMode) {
    channelName = (await validateSlackTarget(actor.userId, merged)).name;
  }

  await prisma.automation.update({ where: { id: record.id }, data: toData(merged, channelName) });

  await recordAudit({
    actorUserId: actor.userId,
    action: "AUTOMATION_UPDATED",
    targetType: "Automation",
    targetId: record.id,
    metadata: { fields: Object.keys(patch) },
  });
}

export async function setAutomationPaused(actor: Actor, automationId: string, paused: boolean) {
  assertPermission(actor, "automation:pause:own");
  const record = await getOwnedRecord(actor, automationId);

  if (record.status === "DISABLED") {
    throw new AppError("AUTOMATION_NOT_ACTIVE", "automation disabled by admin", {
      userMessage: "This automation was disabled by an administrator and cannot be resumed.",
    });
  }

  const next: AutomationStatus = paused ? "PAUSED" : "ACTIVE";
  if (record.status === next) return;

  // Pausing only flips status — configuration and history are untouched.
  await prisma.automation.update({ where: { id: record.id }, data: { status: next } });
  await recordAudit({
    actorUserId: actor.userId,
    action: paused ? "AUTOMATION_PAUSED" : "AUTOMATION_RESUMED",
    targetType: "Automation",
    targetId: record.id,
  });
}

/** Deletes the automation. Executions are kept (automationId set to NULL). */
export async function deleteAutomation(actor: Actor, automationId: string) {
  assertPermission(actor, "automation:delete:own");
  const record = await getOwnedRecord(actor, automationId);
  await prisma.automation.delete({ where: { id: record.id } });
  await recordAudit({
    actorUserId: actor.userId,
    action: "AUTOMATION_DELETED",
    targetType: "Automation",
    targetId: record.id,
    metadata: { name: record.name },
  });
}

/** Admin control: disable/enable any automation. Never edits its configuration. */
export async function adminSetAutomationDisabled(
  actor: Actor,
  automationId: string,
  disabled: boolean,
  reason: string | null,
) {
  assertPermission(actor, "automation:manage:all");
  const record = await prisma.automation.findUnique({ where: { id: automationId }, select: { id: true, userId: true, status: true } });
  if (!record) throw new AuthorizationError("NOT_FOUND");

  await prisma.automation.update({
    where: { id: record.id },
    data: disabled
      ? { status: "DISABLED", disabledReason: reason ?? "Disabled by an administrator." }
      : { status: "PAUSED", disabledReason: null },
  });
  await recordAudit({
    actorUserId: actor.userId,
    action: "ADMIN_ACTION",
    targetType: "Automation",
    targetId: record.id,
    metadata: { operation: disabled ? "automation_disabled" : "automation_enabled", ownerId: record.userId, reason },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test (dry run)
// ─────────────────────────────────────────────────────────────────────────────

export interface PreviewResult {
  executionDate: string;
  commitDate: string;
  commitCount: number;
  repositories: Array<{ fullName: string; branch: string | null; commitCount: number }>;
  commits: Array<{ repository: string; branch: string | null; message: string; url: string | null }>;
  summary: string[];
  parentText: string | null;
  messageText: string | null;
  channel: { id: string; name: string; isPrivate: boolean };
  note: string | null;
  /** Link to the test message posted in Slack. */
  testMessageUrl: string | null;
}

const TEST_PREFIX = "🧪 *Test run* · preview only, not today's update";

/**
 * "Test Automation": runs the real pipeline (live GitHub commits, a real
 * Nemotron summary) and posts the result to the chosen channel as a clearly
 * labelled test, using the same identity and thread layout as a real run.
 *
 * It never touches the day's idempotency key or thread anchor, and test posts
 * carry their own metadata type and prefix, so a later real run neither skips
 * today's update nor threads under the test message.
 */
export async function previewAutomation(actor: Actor, input: PreviewAutomationInput, automationId?: string): Promise<PreviewResult> {
  assertPermission(actor, "automation:test:own");
  if (automationId) await getOwnedRecord(actor, automationId);

  const executionDate = localDayKey(new Date(), input.timezone);
  const window = commitWindow(executionDate, input.timezone, input.commitWindow);

  const channel = await validateSlackTarget(actor.userId, input);
  const { commits, perSource } = await fetchCommitsForSources(
    actor.userId,
    input.githubSources,
    window,
    input.includeFileStats,
  );

  let summary: string[] = [];
  let headline: string | null = null;
  if (commits.length > 0) {
    const result = await generateStandupSummary({
      commits,
      style: input.messageStyle,
      quickNote: input.quickNote,
      wantHeadline: input.threadMode === "AI_PARENT",
      dateLabel: formatLongDate(window.dateKey),
    });
    summary = result.summary.summary;
    headline = result.summary.headline ?? null;
  }

  await recordAudit({
    actorUserId: actor.userId,
    action: "AUTOMATION_TESTED",
    targetType: "Automation",
    targetId: automationId ?? null,
    metadata: { commitCount: commits.length, repositories: perSource.map((source) => source.fullName) },
  });

  const parentText =
    input.threadMode === "NO_THREAD"
      ? null
      : input.threadMode === "AI_PARENT"
        ? buildAiParent(executionDate, headline ?? "Daily update")
        : buildDateHeader(executionDate, input.headerFormat);
  const messageText = summary.length > 0 ? buildUpdateMessage(summary) : null;

  const testMessageUrl = await postTestMessage(actor.userId, input, {
    parentText,
    messageText,
    noCommitsText: `No commits by you were found for ${formatLongDate(window.dateKey)}. A scheduled run would post nothing.`,
  });

  return {
    executionDate,
    commitDate: window.dateKey,
    commitCount: commits.length,
    repositories: perSource,
    commits: commits.slice(0, 50).map((commit) => ({
      repository: commit.repository,
      branch: commit.branch,
      message: commit.message.split("\n")[0] ?? "",
      url: commit.url,
    })),
    summary,
    parentText,
    messageText,
    channel: { id: channel.id, name: channel.name, isPrivate: channel.isPrivate },
    note: commits.length === 0 ? new AppError("NO_COMMITS").userMessage : null,
    testMessageUrl,
  };
}

/** Posts the test as it would appear: a parent with the update threaded under it, or a single message. */
async function postTestMessage(
  userId: string,
  input: Pick<PreviewAutomationInput, "slackIntegrationId" | "slackChannelId" | "postingMode">,
  content: { parentText: string | null; messageText: string | null; noCommitsText: string },
): Promise<string | null> {
  const slack = createSlackPort(userId, input.slackIntegrationId, input.postingMode);
  const metadata = { event_type: TEST_EVENT_TYPE, event_payload: { kind: "test" } };
  const channel = input.slackChannelId;

  if (!content.messageText) {
    const { ts } = await slack.post({ channel, text: `${TEST_PREFIX}\n${content.noCommitsText}`, metadata });
    return slack.permalink(channel, ts);
  }

  if (content.parentText) {
    const parent = await slack.post({ channel, text: `${TEST_PREFIX}\n${content.parentText}`, metadata });
    await slack.post({ channel, text: content.messageText, threadTs: parent.ts, metadata });
    return slack.permalink(channel, parent.ts);
  }

  const { ts } = await slack.post({ channel, text: `${TEST_PREFIX}\n${content.messageText}`, metadata });
  return slack.permalink(channel, ts);
}

/** Local "today" for an automation — used by "Run now". */
export function todayFor(automation: Pick<AutomationSnapshot, "timezone">): string {
  return localDayKey(new Date(), automation.timezone);
}
