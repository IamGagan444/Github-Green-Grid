import "server-only";

import { z } from "zod";

import type { WorkflowKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hubMessageSchema } from "@/lib/hub/message";
import { createLogger } from "@/lib/logging/logger";
import { runWithBudget } from "@/lib/scheduler/due";
import { interleaveByUser, MAX_ATTEMPTS, processRun } from "@/lib/workflow/engine";
import type { ClaimedRun, ClaimedStep, RunOutcome, StepHandler, WorkflowEngineDeps } from "@/lib/workflow/types";
import { deliverToChannel, isBrokenChannelError, markChannelBroken } from "@/services/channel-service";
import { prismaRunStore } from "@/services/workflow-store";

const log = createLogger("workflow");

/** Unclaimed runs older than this are picked up by the cron sweep. */
const STALE_AFTER_MS = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// Step handlers
// ─────────────────────────────────────────────────────────────────────────────

const notifyInputSchema = z.object({ message: hubMessageSchema });
const notifyPayloadSchema = z.object({ channelId: z.string().min(1) });

/**
 * `notify:<channelId>` — deliver the run's message to one channel. Shared by
 * every kind: a form submission, reminder or digest ends with notify steps.
 */
const notifyStep: StepHandler = {
  async run({ run, step }) {
    const { message } = notifyInputSchema.parse(run.input);
    const { channelId } = notifyPayloadSchema.parse(step.payload);
    // Scoped to the run's owner: a step can never deliver through another user's channel.
    const channel = await prisma.notificationChannel.findFirst({
      where: { id: channelId, userId: run.userId },
      select: { id: true, userId: true, kind: true, label: true, configEncrypted: true, verified: true },
    });
    if (!channel || !channel.verified) return { status: "SKIPPED" };
    const sent = await deliverToChannel(channel, message);
    return { externalId: sent.externalId, result: { channelId: channel.id, kind: channel.kind } };
  },
};

type HandlerResolver = (run: ClaimedRun, step: ClaimedStep) => StepHandler | null;

const resolvers = new Map<WorkflowKind, HandlerResolver>();

/** Automations register the step handlers for their workflow kind at module load. */
export function registerStepHandlers(kind: WorkflowKind, resolver: HandlerResolver): void {
  resolvers.set(kind, resolver);
}

function handlerFor(run: ClaimedRun, step: ClaimedStep): StepHandler {
  if (step.key.startsWith("notify:")) return notifyStep;
  const handler = resolvers.get(run.kind)?.(run, step);
  if (handler) return handler;
  return {
    async run() {
      throw new AppError("INTERNAL", `no handler for ${run.kind} step ${step.key}`);
    },
  };
}

async function onPermanentStepFailure(run: ClaimedRun, step: ClaimedStep, error: AppError): Promise<void> {
  log.warn("workflow step failed permanently", { runId: run.id, kind: run.kind, step: step.key, code: error.code });
  if (!step.key.startsWith("notify:") || !isBrokenChannelError(error)) return;
  const parsed = notifyPayloadSchema.safeParse(step.payload);
  if (parsed.success) await markChannelBroken(parsed.data.channelId, error);
}

export function workflowDeps(): WorkflowEngineDeps {
  return { store: prismaRunStore, handlerFor, onPermanentStepFailure };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────────────────

export type RunTotals = Record<RunOutcome, number> & { deferred: number };

/** Runs the given runs (already created). Safe to call concurrently: each run is leased first. */
export async function processRuns(
  runs: ReadonlyArray<{ id: string; userId: string }>,
  options: { deadline: number; concurrency?: number },
): Promise<RunTotals> {
  const totals: Record<RunOutcome, number> = { SUCCESS: 0, FAILED: 0, SKIPPED: 0, RETRY: 0, BUSY: 0 };
  const deps = workflowDeps();
  const { deferred } = await runWithBudget(
    interleaveByUser(runs),
    async (run) => {
      try {
        totals[await processRun(deps, run.id)] += 1;
      } catch (error) {
        // Store failures: the lease expires and the next sweep resumes the run.
        totals.FAILED += 1;
        log.error("workflow run crashed", { runId: run.id, error: error as Error });
      }
    },
    { concurrency: options.concurrency ?? 5, deadline: options.deadline },
  );
  return { ...totals, deferred };
}

/** Cron sweep: due retries, plus runs nobody started (their after() hook never ran). */
export async function drainDueRuns(deadline: number, now = new Date(), limit = 500): Promise<RunTotals> {
  const due = await prisma.workflowRun.findMany({
    where: {
      status: "RUNNING",
      attempt: { lt: MAX_ATTEMPTS },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      AND: [
        {
          OR: [
            { nextRetryAt: { lte: now } },
            { nextRetryAt: null, createdAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
          ],
        },
      ],
    },
    select: { id: true, userId: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return processRuns(due, { deadline });
}

/**
 * Manual retry of a failed run. Steps that already succeeded are kept (never
 * re-sent), and UNKNOWN steps stay UNKNOWN: the user must check those by hand.
 */
export async function retryRun(userId: string, runId: string): Promise<void> {
  const run = await prisma.workflowRun.findFirst({ where: { id: runId, userId }, select: { id: true, status: true, input: true } });
  if (!run) throw new AppError("INTERNAL", "run not found", { userMessage: "That run was not found." });
  if (run.status !== "FAILED") throw new AppError("INTERNAL", "run not failed", { userMessage: "Only failed runs can be retried." });
  if (run.input === null) {
    throw new AppError("INTERNAL", "run input pruned", { userMessage: "This run is too old to retry." });
  }
  await prisma.$transaction([
    prisma.workflowStep.updateMany({ where: { runId, status: "FAILED" }, data: { status: "PENDING", errorCode: null, errorMessage: null } }),
    prisma.workflowRun.update({
      where: { id: runId },
      data: { status: "RUNNING", attempt: 0, nextRetryAt: null, leaseExpiresAt: null, finishedAt: null, trigger: "MANUAL" },
    }),
  ]);
}
