import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { NotificationSource } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { HubMessage } from "@/lib/hub/message";
import {
  describeRuleFilter,
  eventDataSchema,
  matchRule,
  parseRuleFilter,
  type EventAttrs,
} from "@/lib/hub/rules";
import { createLogger } from "@/lib/logging/logger";
import type { Actor } from "@/lib/rbac";
import { recordAudit } from "@/services/audit-service";
import { processRuns, type RunTotals } from "@/services/workflow-service";
import { createRunIfAbsent } from "@/services/workflow-store";

const log = createLogger("notifications");

const UNIQUE_VIOLATION = "P2002";
/** Events the producer did not fan out within this window are swept by the cron. */
const SWEEP_AFTER_MS = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// Ingest and fan-out
// ─────────────────────────────────────────────────────────────────────────────

export interface NewEvent {
  userId: string;
  source: NotificationSource;
  type: string;
  idempotencyKey: string;
  attrs: EventAttrs;
  message: HubMessage;
  occurredAt?: Date;
}

/** Stores an event once; a redelivery with the same key returns `created: false`. */
export async function ingestEvent(event: NewEvent): Promise<{ id: string; created: boolean }> {
  const data = eventDataSchema.parse({ attrs: event.attrs, message: event.message });
  try {
    const row = await prisma.notificationEvent.create({
      data: {
        userId: event.userId,
        source: event.source,
        type: event.type.slice(0, 80),
        idempotencyKey: event.idempotencyKey,
        data: data as Prisma.InputJsonValue,
        occurredAt: event.occurredAt ?? new Date(),
      },
      select: { id: true },
    });
    return { id: row.id, created: true };
  } catch (error) {
    if ((error as { code?: string })?.code !== UNIQUE_VIOLATION) throw error;
    const existing = await prisma.notificationEvent.findUniqueOrThrow({
      where: { idempotencyKey: event.idempotencyKey },
      select: { id: true },
    });
    return { id: existing.id, created: false };
  }
}

/**
 * One NOTIFY run per matching rule, one step per verified target channel.
 * Idempotent: keys derive from (event, rule, channel), so a second fan-out of
 * the same event creates nothing new.
 */
export async function fanOutEvent(eventId: string): Promise<Array<{ id: string; userId: string }>> {
  const event = await prisma.notificationEvent.findUnique({ where: { id: eventId } });
  if (!event) return [];
  const parsed = eventDataSchema.safeParse(event.data);
  if (!parsed.success) {
    log.warn("notification event has invalid data", { eventId });
    await prisma.notificationEvent.update({ where: { id: eventId }, data: { fannedOutAt: new Date() } });
    return [];
  }

  const rules = await prisma.notificationRule.findMany({
    where: { userId: event.userId, source: event.source, enabled: true },
    select: {
      id: true,
      source: true,
      filter: true,
      targets: { where: { channel: { verified: true } }, select: { channelId: true } },
    },
  });

  const runs: Array<{ id: string; userId: string }> = [];
  for (const rule of rules) {
    if (rule.targets.length === 0) continue;
    if (!matchRule(rule, { source: event.source, type: event.type, attrs: parsed.data.attrs })) continue;

    const key = `notify:${event.id}:${rule.id}`;
    const run = await createRunIfAbsent({
      userId: event.userId,
      kind: "NOTIFY",
      idempotencyKey: key,
      title: parsed.data.message.title,
      subjectType: "NotificationEvent",
      subjectId: event.id,
      input: { message: parsed.data.message, ruleId: rule.id } as Prisma.InputJsonValue,
      scheduledFor: event.occurredAt,
      steps: rule.targets.map((target) => ({
        key: `notify:${target.channelId}`,
        idempotencyKey: `${key}:${target.channelId}`,
        payload: { channelId: target.channelId },
      })),
    });
    runs.push({ id: run.id, userId: event.userId });
  }

  await prisma.notificationEvent.update({ where: { id: event.id }, data: { fannedOutAt: new Date() } });
  return runs;
}

/** Fan out and deliver now (webhook `after()` hook); anything left over is swept by the cron. */
export async function processEventNow(eventId: string, deadline: number): Promise<RunTotals | null> {
  const runs = await fanOutEvent(eventId);
  if (runs.length === 0) return null;
  return processRuns(runs, { deadline, concurrency: 3 });
}

export async function sweepUnfannedEvents(now = new Date(), limit = 200): Promise<number> {
  const events = await prisma.notificationEvent.findMany({
    where: { fannedOutAt: null, createdAt: { lt: new Date(now.getTime() - SWEEP_AFTER_MS) } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const event of events) {
    try {
      await fanOutEvent(event.id);
    } catch (error) {
      log.error("event fan-out failed", { eventId: event.id, error: error as Error });
    }
  }
  return events.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rules
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleView {
  id: string;
  name: string;
  source: NotificationSource;
  enabled: boolean;
  summary: string;
  channels: Array<{ id: string; label: string; kind: string; verified: boolean }>;
  createdAt: Date;
}

export async function listRules(userId: string): Promise<RuleView[]> {
  const rules = await prisma.notificationRule.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      source: true,
      enabled: true,
      filter: true,
      createdAt: true,
      targets: { select: { channel: { select: { id: true, label: true, kind: true, verified: true } } } },
    },
  });
  return rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    source: rule.source,
    enabled: rule.enabled,
    summary: describeRuleFilter(rule.source, rule.filter),
    channels: rule.targets.map((target) => target.channel),
    createdAt: rule.createdAt,
  }));
}

const MAX_RULES_PER_USER = 50;

async function assertOwnChannels(userId: string, channelIds: string[]): Promise<void> {
  const unique = [...new Set(channelIds)];
  if (unique.length === 0) throw new AppError("INTERNAL", "no channels", { userMessage: "Pick at least one channel." });
  const owned = await prisma.notificationChannel.count({ where: { userId, id: { in: unique } } });
  if (owned !== unique.length) {
    throw new AppError("INTERNAL", "channel not owned", { userMessage: "One of the selected channels was not found." });
  }
}

export async function createRule(
  actor: Actor,
  input: { name: string; source: NotificationSource; filter: unknown; channelIds: string[] },
): Promise<string> {
  const filter = parseRuleFilter(input.source, input.filter);
  await assertOwnChannels(actor.userId, input.channelIds);
  if ((await prisma.notificationRule.count({ where: { userId: actor.userId } })) >= MAX_RULES_PER_USER) {
    throw new AppError("INTERNAL", "rule limit", { userMessage: `You can have up to ${MAX_RULES_PER_USER} rules.` });
  }

  const rule = await prisma.notificationRule.create({
    data: {
      userId: actor.userId,
      name: input.name.slice(0, 80),
      source: input.source,
      filter: filter as Prisma.InputJsonValue,
      targets: { create: [...new Set(input.channelIds)].map((channelId) => ({ channelId })) },
    },
    select: { id: true },
  });
  await recordAudit({ actorUserId: actor.userId, action: "RULE_CREATED", targetType: "NotificationRule", targetId: rule.id, metadata: { source: input.source } });
  return rule.id;
}

async function ownedRule(actor: Actor, ruleId: string) {
  const rule = await prisma.notificationRule.findFirst({ where: { id: ruleId, userId: actor.userId }, select: { id: true } });
  if (!rule) throw new AppError("INTERNAL", "rule not found", { userMessage: "That rule was not found." });
  return rule;
}

export async function setRuleEnabled(actor: Actor, ruleId: string, enabled: boolean): Promise<void> {
  const rule = await ownedRule(actor, ruleId);
  await prisma.notificationRule.update({ where: { id: rule.id }, data: { enabled } });
  await recordAudit({ actorUserId: actor.userId, action: "RULE_UPDATED", targetType: "NotificationRule", targetId: rule.id, metadata: { enabled } });
}

export async function deleteRule(actor: Actor, ruleId: string): Promise<void> {
  const rule = await ownedRule(actor, ruleId);
  await prisma.notificationRule.delete({ where: { id: rule.id } });
  await recordAudit({ actorUserId: actor.userId, action: "RULE_DELETED", targetType: "NotificationRule", targetId: rule.id });
}

// ─────────────────────────────────────────────────────────────────────────────
// History
// ─────────────────────────────────────────────────────────────────────────────

export async function listRecentRuns(userId: string, take = 25) {
  return prisma.workflowRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      kind: true,
      title: true,
      status: true,
      nextRetryAt: true,
      errorMessage: true,
      createdAt: true,
      _count: { select: { steps: true } },
    },
  });
}

export async function getRunForUser(userId: string, runId: string) {
  return prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    select: {
      id: true,
      kind: true,
      title: true,
      status: true,
      trigger: true,
      attempt: true,
      nextRetryAt: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      steps: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          key: true,
          status: true,
          semantics: true,
          attempt: true,
          externalId: true,
          errorMessage: true,
          completedAt: true,
        },
      },
    },
  });
}
