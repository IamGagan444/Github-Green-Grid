import "server-only";

import { prisma } from "@/lib/db";
import {
  advanceActivityFile,
  commitFile,
  checkRepositoryWritable,
  getActivityFile,
  getGitHubClient,
  GitHubApiError,
  serialiseActivityFile,
  toGitHubApiError,
} from "@/lib/github";
import { getLocalDayKey } from "@/lib/schedule/timezone";
import type { ExecutionTrigger } from "@/generated/prisma/enums";

export type RunOutcome =
  | { status: "COMPLETED"; executionId: string; commitSha: string; commitUrl: string; commitMessage: string; repositoryFullName: string; executedAt: Date }
  | { status: "SKIPPED"; reason: string; executionId: string | null }
  | { status: "FAILED"; reason: string; retryable: boolean; executionId: string | null };

export interface RunRequest {
  scheduleId: string;
  trigger: ExecutionTrigger;
  /** Local day in the schedule's timezone; defaults to "today" there. */
  dayKey?: string;
  /** 0-based slot within the day. Part of the scheduled idempotency key. */
  slotIndex?: number;
  /** UTC instant the run was scheduled for; defaults to now. */
  scheduledFor?: Date;
}

const DUPLICATE_KEY_ERROR = "P2002";

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === DUPLICATE_KEY_ERROR
  );
}

/**
 * Performs one maintenance update for a schedule: read the activity file,
 * increment it, and commit the result. Exactly one commit per invocation.
 *
 * Idempotent for scheduled runs — the `idempotencyKey` unique index means a
 * repeated cron delivery for the same schedule and local day is a no-op.
 */
export async function runScheduledActivity(request: RunRequest): Promise<RunOutcome> {
  const schedule = await prisma.schedule.findUnique({
    where: { id: request.scheduleId },
    include: { repository: true },
  });

  if (!schedule) {
    return { status: "FAILED", reason: "Schedule not found.", retryable: false, executionId: null };
  }

  if (request.trigger === "SCHEDULED" && !schedule.enabled) {
    return { status: "SKIPPED", reason: "Automation is paused for this schedule.", executionId: null };
  }

  const repository = schedule.repository;
  const dayKey = request.dayKey ?? getLocalDayKey(new Date(), schedule.timezone);
  const scheduledFor = request.scheduledFor ?? new Date();
  const slotIndex = request.slotIndex ?? 0;
  const idempotencyKey =
    request.trigger === "SCHEDULED" ? `${schedule.id}:${dayKey}:${slotIndex}` : null;

  let executionId: string;
  const startedAt = Date.now();

  try {
    const execution = await prisma.activityExecution.create({
      data: {
        scheduleId: schedule.id,
        repositoryId: repository.id,
        userId: schedule.userId,
        scheduledDay: dayKey,
        scheduledFor,
        status: "PENDING",
        trigger: request.trigger,
        idempotencyKey,
      },
      select: { id: true },
    });
    executionId = execution.id;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return {
        status: "SKIPPED",
        reason: "This schedule already ran for this day.",
        executionId: null,
      };
    }
    throw error;
  }

  try {
    const octokit = await getGitHubClient(schedule.userId);

    const writeCheck = await checkRepositoryWritable(octokit, repository.owner, repository.name);
    if (!writeCheck.writable) {
      return await recordFailure(
        executionId,
        "REPOSITORY_NOT_WRITABLE",
        writeCheck.reason ?? "GreenGrid can no longer write to this repository.",
        false,
        startedAt,
      );
    }

    const branch = writeCheck.defaultBranch ?? repository.defaultBranch;

    const state = await getActivityFile(
      octokit,
      repository.owner,
      repository.name,
      schedule.activityPath,
      branch,
      dayKey,
    );

    const nextContents = advanceActivityFile(state.contents, dayKey);

    const commit = await commitFile(octokit, {
      owner: repository.owner,
      repo: repository.name,
      path: schedule.activityPath,
      branch,
      message: schedule.commitMessage,
      content: serialiseActivityFile(nextContents),
      sha: state.sha,
    });

    const executedAt = new Date();

    await prisma.$transaction([
      prisma.activityExecution.update({
        where: { id: executionId },
        data: {
          status: "COMPLETED",
          executedAt,
          durationMs: Date.now() - startedAt,
          commitSha: commit.sha,
          commitUrl: commit.url,
          commitMessage: commit.message,
        },
      }),
      prisma.schedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: executedAt },
      }),
      prisma.repository.update({
        where: { id: repository.id },
        data: { lastActivityAt: executedAt, defaultBranch: branch },
      }),
    ]);

    return {
      status: "COMPLETED",
      executionId,
      commitSha: commit.sha,
      commitUrl: commit.url,
      commitMessage: commit.message,
      repositoryFullName: repository.fullName,
      executedAt,
    };
  } catch (error) {
    const apiError =
      error instanceof GitHubApiError ? error : toGitHubApiError(error, "runScheduledActivity");

    // Detail is logged server-side; only `userMessage` reaches the client.
    console.error("[activity] execution failed", {
      executionId,
      scheduleId: schedule.id,
      code: apiError.code,
      status: apiError.status,
    });

    return await recordFailure(
      executionId,
      apiError.code,
      apiError.userMessage,
      apiError.retryable,
      startedAt,
    );
  }
}

async function recordFailure(
  executionId: string,
  errorCode: string,
  userMessage: string,
  retryable: boolean,
  startedAt: number,
): Promise<RunOutcome> {
  await prisma.activityExecution.update({
    where: { id: executionId },
    data: {
      status: "FAILED",
      executedAt: new Date(),
      durationMs: Date.now() - startedAt,
      errorCode,
      errorMessage: userMessage,
      // A retryable failure should not permanently consume the day's slot.
      ...(retryable ? { idempotencyKey: null } : {}),
    },
  });

  return { status: "FAILED", reason: userMessage, retryable, executionId };
}
