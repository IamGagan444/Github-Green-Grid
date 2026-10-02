import { AppError, toAppError } from "@/lib/errors";
import { executionKey, localMidnight } from "@/lib/automation/schedule";
import type {
  AutomationSnapshot,
  CommitRange,
  EngineDeps,
  EngineOutcome,
  ExecutionRow,
  AnchorKey,
} from "@/lib/automation/types";
import { buildAiParent, buildDateHeader, buildUpdateMessage, formatLongDate } from "@/lib/slack/message";
import {
  findDailyParent,
  findExistingUpdate,
  headerMetadata,
  updateMetadata,
} from "@/lib/slack/thread";
import type { RunTrigger } from "@/generated/prisma/enums";

/**
 * The standup execution pipeline:
 *
 *   claim(idempotency key) → GitHub commits → AI summary → Slack parent → Slack reply
 *
 * Duplicate protection, in layers:
 *  1. `Execution.idempotencyKey` = automationId:executionDate:slot is UNIQUE.
 *     Only one row per automation per day per schedule time can exist; `claim`
 *     hands it to exactly one worker (lease + optimistic takeover).
 *  2. A SUCCESS row is terminal: nothing re-posts it.
 *  3. Resumes reuse stored state: the AI output and parent ts are persisted as
 *     soon as they exist, so a retry never regenerates a different message or
 *     creates a second parent.
 *  4. Every post carries Slack message metadata with the execution key. Before
 *     posting on a resumed attempt, the thread is scanned for that key — a
 *     crash between "posted" and "saved" cannot produce a second message.
 *  5. `SlackThreadAnchor` is UNIQUE per (team, channel, day, header) so
 *     concurrent automations — and several posts a day — share one daily parent.
 *  6. Each execution stores the commit range it covers, so a retry summarises
 *     the same commits and consecutive posts in a day never overlap.
 */

export const MAX_ATTEMPTS = 3;
export const LEASE_MS = 5 * 60_000;
export const RETRY_BASE_MS = 10 * 60_000;
const ANCHOR_STALE_MS = 2 * 60_000;
const ANCHOR_WAIT_ATTEMPTS = 4;
const ANCHOR_WAIT_MS = 1_500;

export interface ExecuteRequest {
  automation: AutomationSnapshot;
  executionDate: string;
  /** "HH:MM" schedule time, or a "manual-…" id for Run now. */
  slot: string;
  /** Commits to summarise if this creates the execution; a resumed one keeps its stored range. */
  window: CommitRange;
  trigger: RunTrigger;
  scheduledFor?: Date | null;
}

type Phase = "github" | "ai" | "slack";

export function retryDelayMs(attempt: number): number {
  return RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
}

export async function executeAutomation(deps: EngineDeps, request: ExecuteRequest): Promise<EngineOutcome> {
  const { automation, executionDate, slot, trigger } = request;

  if (trigger === "SCHEDULED" && automation.status !== "ACTIVE") {
    return { status: "SKIPPED", executionId: null, reason: "Automation is not active." };
  }

  const startedAt = deps.now();
  const key = executionKey(automation.id, executionDate, slot);
  const claim = await deps.store.claim({
    automation,
    executionDate,
    slot,
    window: request.window,
    idempotencyKey: key,
    trigger,
    scheduledFor: request.scheduledFor ?? null,
    now: startedAt,
    leaseMs: LEASE_MS,
    maxAttempts: MAX_ATTEMPTS,
  });

  if (claim.kind !== "claimed") {
    return {
      status: "NOOP",
      executionId: "execution" in claim ? claim.execution.id : null,
      reason: claim.kind,
    };
  }

  const execution = claim.execution;
  const resumed = execution.attempt > 1;
  let phase: Phase = "github";

  try {
    // ── 1 + 2. Commits and AI summary (skipped when resuming with stored output)
    let summary = execution.aiOutput;
    if (!summary) {
      const window = storedWindow(execution, request.window.dateKey) ?? request.window;
      const { commits, perSource } = await deps.github.fetchCommits(automation, window);

      await deps.store.update(execution.id, {
        githubStatus: "SUCCESS",
        commitCount: commits.length,
        repositories: perSource,
      });

      if (commits.length === 0) {
        await deps.store.update(execution.id, {
          status: "SKIPPED",
          aiStatus: "SKIPPED",
          slackStatus: "SKIPPED",
          errorCode: "NO_COMMITS",
          errorMessage: new AppError("NO_COMMITS").userMessage,
          finishedAt: deps.now(),
          durationMs: deps.now().getTime() - startedAt.getTime(),
          leaseExpiresAt: null,
          nextRetryAt: null,
        });
        return { status: "SKIPPED", executionId: execution.id, reason: "NO_COMMITS" };
      }

      phase = "ai";
      const result = await deps.ai.summarize({
        commits,
        automation,
        dateLabel: formatLongDate(window.dateKey),
      });
      summary = result.summary;

      await deps.store.update(execution.id, {
        aiStatus: "SUCCESS",
        aiOutput: summary,
        aiModel: result.model,
        messageText: buildUpdateMessage(summary.summary),
      });
    }

    // ── 3. Slack
    phase = "slack";
    if (execution.slackReplyTs) {
      await finishSuccess(deps, execution.id, startedAt);
      return { status: "SUCCESS", executionId: execution.id, resumed };
    }

    const messageText = buildUpdateMessage(summary.summary);
    const channel = await deps.slack.prepareChannel(automation.slackChannelId);
    const teamId = await deps.slack.teamId();
    await deps.store.update(execution.id, {
      slackTeamId: teamId,
      slackChannelId: automation.slackChannelId,
      slackChannelName: channel.name,
    });

    let parentTs: string | null = execution.slackParentTs;
    if (automation.threadMode !== "NO_THREAD" && !parentTs) {
      parentTs = await resolveDailyParent(deps, automation, executionDate, teamId, summary.headline ?? null);
      await deps.store.update(execution.id, { slackParentTs: parentTs });
    }

    // Resume safety: the previous attempt may have posted before crashing.
    if (resumed) {
      const scope = parentTs
        ? await deps.slack.replies(automation.slackChannelId, parentTs)
        : await deps.slack.history(
            automation.slackChannelId,
            localMidnight(executionDate, automation.timezone).getTime() / 1000,
          );
      const existing = findExistingUpdate(scope, key, messageText);
      if (existing) {
        await deps.store.update(execution.id, {
          slackReplyTs: existing.ts,
          slackPermalink: await deps.slack.permalink(automation.slackChannelId, existing.ts),
        });
        await finishSuccess(deps, execution.id, startedAt);
        return { status: "SUCCESS", executionId: execution.id, resumed };
      }
    }

    const reply = await deps.slack.post({
      channel: automation.slackChannelId,
      text: messageText,
      ...(parentTs ? { threadTs: parentTs } : {}),
      metadata: updateMetadata(key, execution.id),
    });

    // Persist the reply ts immediately — this is the "posted" marker.
    await deps.store.update(execution.id, { slackReplyTs: reply.ts });
    const permalink = await deps.slack.permalink(automation.slackChannelId, reply.ts);
    await deps.store.update(execution.id, { slackPermalink: permalink });
    await finishSuccess(deps, execution.id, startedAt);

    return { status: "SUCCESS", executionId: execution.id, resumed };
  } catch (error) {
    const appError = toAppError(error, `execute:${phase}`);
    const retryable = appError.retryable && execution.attempt < MAX_ATTEMPTS;
    const now = deps.now();

    await deps.store.update(execution.id, {
      status: "FAILED",
      ...(phase === "github"
        ? { githubStatus: "FAILED", aiStatus: "SKIPPED", slackStatus: "SKIPPED" }
        : phase === "ai"
          ? { aiStatus: "FAILED", slackStatus: "SKIPPED" }
          : { slackStatus: "FAILED" }),
      errorCode: appError.code,
      errorMessage: appError.userMessage,
      finishedAt: now,
      durationMs: now.getTime() - startedAt.getTime(),
      leaseExpiresAt: null,
      nextRetryAt: retryable ? new Date(now.getTime() + retryDelayMs(execution.attempt)) : null,
    });

    return {
      status: "FAILED",
      executionId: execution.id,
      code: appError.code,
      message: appError.userMessage,
      retryable,
    };
  }
}

function storedWindow(execution: ExecutionRow, dateKey: string): CommitRange | null {
  if (!execution.windowStart || !execution.windowEnd) return null;
  return { dateKey, since: execution.windowStart, until: execution.windowEnd };
}

async function finishSuccess(deps: EngineDeps, executionId: string, startedAt: Date): Promise<void> {
  const now = deps.now();
  await deps.store.update(executionId, {
    status: "SUCCESS",
    slackStatus: "SUCCESS",
    errorCode: null,
    errorMessage: null,
    finishedAt: now,
    durationMs: now.getTime() - startedAt.getTime(),
    leaseExpiresAt: null,
    nextRetryAt: null,
  });
}

/**
 * Finds or creates today's parent message, guaranteeing a single parent per
 * channel/day/header across concurrent workers.
 */
export async function resolveDailyParent(
  deps: EngineDeps,
  automation: AutomationSnapshot,
  executionDate: string,
  teamId: string,
  headline: string | null,
): Promise<string> {
  const isAiParent = automation.threadMode === "AI_PARENT";
  const headerText = isAiParent
    ? buildAiParent(executionDate, headline ?? automation.name)
    : buildDateHeader(executionDate, automation.headerFormat);
  const anchorKey = isAiParent ? `ai:${automation.id}` : `header:${buildDateHeader(executionDate, automation.headerFormat)}`;

  const key: AnchorKey = {
    teamId,
    channelId: automation.slackChannelId,
    dateKey: executionDate,
    anchorKey,
  };

  for (let attempt = 0; attempt < ANCHOR_WAIT_ATTEMPTS; attempt += 1) {
    const claim = await deps.anchors.claim(key, deps.now(), ANCHOR_STALE_MS);
    if (claim.kind === "existing") return claim.parentTs;

    if (claim.kind === "claimed") {
      // We own creation. The header may already exist in Slack (posted by a
      // teammate, by hand, or by a previous attempt that crashed) — search first.
      const history = await deps.slack.history(
        automation.slackChannelId,
        localMidnight(executionDate, automation.timezone).getTime() / 1000,
      );
      const found = findDailyParent(history, { dateKey: executionDate, anchorKey, headerText });
      const parentTs = found
        ? found.ts
        : (
            await deps.slack.post({
              channel: automation.slackChannelId,
              text: headerText,
              metadata: headerMetadata(executionDate, anchorKey),
            })
          ).ts;
      await deps.anchors.set(key, parentTs);
      return parentTs;
    }

    // Another worker is creating the parent right now; give it a moment.
    await deps.sleep(ANCHOR_WAIT_MS);
  }

  throw new AppError("SLACK_UNAVAILABLE", "daily parent is being created by another worker");
}

export type { ExecutionRow };
