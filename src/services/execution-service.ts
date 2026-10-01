import "server-only";

import { executeAutomation } from "@/lib/automation/engine";
import { evaluateTakeover } from "@/lib/automation/takeover";
import type {
  AnchorClaim,
  AnchorKey,
  AutomationSnapshot,
  ClaimInput,
  ClaimResult,
  EngineDeps,
  EngineOutcome,
  ExecutionPatch,
  ExecutionRow,
  ExecutionStore,
  ThreadAnchorStore,
} from "@/lib/automation/types";
import { aiSummarySchema } from "@/lib/ai/schema";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logging/logger";
import { assertResourceAccess, AuthorizationError, type Actor } from "@/lib/rbac";
import { Prisma } from "@/generated/prisma/client";
import type { RunStatus, RunTrigger } from "@/generated/prisma/enums";
import { recordAudit } from "@/services/audit-service";
import { createAiPort } from "@/services/ai-service";
import { createGitHubPort } from "@/services/github-service";
import { createSlackPort } from "@/services/slack-service";
import { toSnapshot } from "@/services/automation-service";

const log = createLogger("execution-service");

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

const rowSelect = {
  id: true,
  idempotencyKey: true,
  status: true,
  attempt: true,
  aiOutput: true,
  messageText: true,
  commitCount: true,
  slackParentTs: true,
  slackReplyTs: true,
  leaseExpiresAt: true,
  nextRetryAt: true,
  updatedAt: true,
} as const;

type RawRow = {
  id: string;
  idempotencyKey: string;
  status: RunStatus;
  attempt: number;
  aiOutput: unknown;
  messageText: string | null;
  commitCount: number | null;
  slackParentTs: string | null;
  slackReplyTs: string | null;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
  updatedAt: Date;
};

function toRow(raw: RawRow): ExecutionRow {
  const parsed = raw.aiOutput ? aiSummarySchema.safeParse(raw.aiOutput) : null;
  return {
    id: raw.id,
    idempotencyKey: raw.idempotencyKey,
    status: raw.status,
    attempt: raw.attempt,
    aiOutput: parsed?.success ? parsed.data : null,
    messageText: raw.messageText,
    commitCount: raw.commitCount,
    slackParentTs: raw.slackParentTs,
    slackReplyTs: raw.slackReplyTs,
  };
}


export const prismaExecutionStore: ExecutionStore = {
  async claim(input: ClaimInput): Promise<ClaimResult> {
    const lease = new Date(input.now.getTime() + input.leaseMs);

    try {
      const created = await prisma.execution.create({
        data: {
          automationId: input.automation.id,
          userId: input.automation.userId,
          automationName: input.automation.name,
          executionDate: input.executionDate,
          idempotencyKey: input.idempotencyKey,
          trigger: input.trigger,
          status: "RUNNING",
          attempt: 1,
          leaseExpiresAt: lease,
          scheduledFor: input.scheduledFor,
          startedAt: input.now,
        },
        select: rowSelect,
      });
      return { kind: "claimed", execution: toRow(created) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const existing = await prisma.execution.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: rowSelect,
    });
    if (!existing) return { kind: "in_progress" };

    const decision = evaluateTakeover(existing, input.trigger, input.now, input.maxAttempts);
    if (decision !== "takeover") {
      return decision === "in_progress" ? { kind: "in_progress" } : { kind: decision, execution: toRow(existing) };
    }

    // Optimistic takeover: only succeeds if nobody changed the row since we read it.
    const { count } = await prisma.execution.updateMany({
      where: { id: existing.id, updatedAt: existing.updatedAt, status: existing.status },
      data: {
        status: "RUNNING",
        attempt: { increment: 1 },
        leaseExpiresAt: lease,
        nextRetryAt: null,
        trigger: input.trigger,
        startedAt: input.now,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
        ...(existing.status === "SKIPPED"
          ? {
              githubStatus: "PENDING",
              aiStatus: "PENDING",
              slackStatus: "PENDING",
              aiOutput: Prisma.DbNull,
              messageText: null,
              commitCount: null,
            }
          : {}),
      },
    });
    if (count !== 1) return { kind: "in_progress" };

    const claimed = await prisma.execution.findUniqueOrThrow({ where: { id: existing.id }, select: rowSelect });
    return { kind: "claimed", execution: toRow(claimed) };
  },

  async update(executionId: string, patch: ExecutionPatch): Promise<void> {
    const { aiOutput, repositories, ...rest } = patch;
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        ...rest,
        ...(aiOutput !== undefined ? { aiOutput: aiOutput as unknown as Prisma.InputJsonValue } : {}),
        ...(repositories !== undefined ? { repositories: repositories as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  },
};

export const prismaAnchorStore: ThreadAnchorStore = {
  async claim(key: AnchorKey, now: Date, staleAfterMs: number): Promise<AnchorClaim> {
    const where = {
      teamId_channelId_dateKey_anchorKey: {
        teamId: key.teamId,
        channelId: key.channelId,
        dateKey: key.dateKey,
        anchorKey: key.anchorKey,
      },
    };

    try {
      await prisma.slackThreadAnchor.create({ data: { ...key, claimedAt: now } });
      return { kind: "claimed" };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const existing = await prisma.slackThreadAnchor.findUnique({ where });
    if (!existing) return { kind: "pending" };
    if (existing.parentTs) return { kind: "existing", parentTs: existing.parentTs };

    // A claim that never completed (worker crashed) may be taken over.
    if (now.getTime() - existing.claimedAt.getTime() > staleAfterMs) {
      const { count } = await prisma.slackThreadAnchor.updateMany({
        where: { id: existing.id, parentTs: null, claimedAt: existing.claimedAt },
        data: { claimedAt: now },
      });
      if (count === 1) return { kind: "claimed" };
    }
    return { kind: "pending" };
  },

  async set(key: AnchorKey, parentTs: string): Promise<void> {
    await prisma.slackThreadAnchor.update({
      where: {
        teamId_channelId_dateKey_anchorKey: {
          teamId: key.teamId,
          channelId: key.channelId,
          dateKey: key.dateKey,
          anchorKey: key.anchorKey,
        },
      },
      data: { parentTs },
    });
  },
};

function productionDeps(automation: AutomationSnapshot): EngineDeps {
  return {
    store: prismaExecutionStore,
    anchors: prismaAnchorStore,
    github: createGitHubPort(automation.userId),
    ai: createAiPort(),
    slack: createSlackPort(automation.userId, automation.slackIntegrationId, automation.postingMode),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/**
 * Runs one automation for one local day with production dependencies and
 * records the outcome in the audit log.
 */
export async function runAutomation(input: {
  automationId: string;
  executionDate: string;
  trigger: RunTrigger;
  scheduledFor?: Date | null;
  actorUserId: string | null;
}): Promise<EngineOutcome> {
  const record = await prisma.automation.findUnique({ where: { id: input.automationId } });
  if (!record) throw new AppError("INTERNAL", "automation not found for execution");
  const automation = toSnapshot(record);

  const outcome = await executeAutomation(productionDeps(automation), {
    automation,
    executionDate: input.executionDate,
    trigger: input.trigger,
    scheduledFor: input.scheduledFor ?? null,
  });

  if (outcome.status === "SUCCESS" || outcome.status === "FAILED" || outcome.status === "SKIPPED") {
    await prisma.automation.update({
      where: { id: automation.id },
      data: { lastExecutionAt: new Date() },
    });
  }

  if (outcome.status === "SUCCESS" || outcome.status === "FAILED") {
    await recordAudit({
      actorUserId: input.actorUserId,
      action: outcome.status === "SUCCESS" ? "AUTOMATION_EXECUTED" : "AUTOMATION_FAILED",
      targetType: "Automation",
      targetId: automation.id,
      metadata: {
        executionId: outcome.executionId,
        executionDate: input.executionDate,
        trigger: input.trigger,
        ...(outcome.status === "FAILED" ? { code: outcome.code, retryable: outcome.retryable } : {}),
      },
    });
  }

  // No-ops (already done / in progress / retry not due) repeat every tick; keep them out of info logs.
  const level = outcome.status === "NOOP" ? "debug" : outcome.status === "FAILED" ? "warn" : "info";
  log[level]("automation run finished", {
    automationId: automation.id,
    executionDate: input.executionDate,
    trigger: input.trigger,
    status: outcome.status,
    ...(outcome.status === "FAILED" ? { code: outcome.code } : {}),
  });

  return outcome;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read models
// ─────────────────────────────────────────────────────────────────────────────

const listSelect = {
  id: true,
  automationId: true,
  automationName: true,
  executionDate: true,
  trigger: true,
  status: true,
  attempt: true,
  githubStatus: true,
  aiStatus: true,
  slackStatus: true,
  commitCount: true,
  errorCode: true,
  errorMessage: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  slackChannelName: true,
  slackPermalink: true,
  userId: true,
  user: { select: { name: true, email: true } },
} as const;

export interface ExecutionListQuery {
  /** Restrict to one user; omitted only for admin-wide listings. */
  userId?: string;
  automationId?: string;
  status?: RunStatus;
  page: number;
  pageSize: number;
}

export async function listExecutions(query: ExecutionListQuery) {
  const where: Prisma.ExecutionWhereInput = {
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.automationId ? { automationId: query.automationId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.execution.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: listSelect,
    }),
    prisma.execution.count({ where }),
  ]);
  return { items, total };
}

/** Loads an execution the actor may see (owner, or admin). Never returns secrets. */
export async function getExecutionForActor(actor: Actor, executionId: string) {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    select: {
      ...listSelect,
      repositories: true,
      aiOutput: true,
      aiModel: true,
      messageText: true,
      slackTeamId: true,
      slackChannelId: true,
      slackParentTs: true,
      slackReplyTs: true,
      scheduledFor: true,
      createdAt: true,
      updatedAt: true,
      nextRetryAt: true,
      idempotencyKey: true,
    },
  });
  if (!execution) throw new AuthorizationError("NOT_FOUND");
  assertResourceAccess(actor, execution.userId, "execution:read:own", "execution:read:all");
  return execution;
}
