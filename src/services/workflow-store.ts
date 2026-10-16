import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { DeliverySemantics, RunTrigger, WorkflowKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { MAX_ATTEMPTS } from "@/lib/workflow/engine";
import type { RunStore } from "@/lib/workflow/types";

/**
 * Postgres persistence for the workflow engine. Claiming is a conditional
 * `updateMany` (compare-and-swap on status, lease and retry time), the same
 * pattern Instagram events use, so no row locks are held across provider calls.
 */

export const prismaRunStore: RunStore = {
  async claim(runId, leaseMs, now) {
    const { count } = await prisma.workflowRun.updateMany({
      where: {
        id: runId,
        status: "RUNNING",
        attempt: { lt: MAX_ATTEMPTS },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        AND: [{ OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] }],
      },
      data: {
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        attempt: { increment: 1 },
        nextRetryAt: null,
      },
    });
    if (count === 0) return null;

    const row = await prisma.workflowRun.findUniqueOrThrow({
      where: { id: runId },
      include: { steps: { orderBy: { position: "asc" } } },
    });
    if (!row.startedAt) {
      await prisma.workflowRun.update({ where: { id: runId }, data: { startedAt: now } });
    }

    return {
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      idempotencyKey: row.idempotencyKey,
      title: row.title,
      input: row.input,
      attempt: row.attempt,
      steps: row.steps.map((step) => ({
        id: step.id,
        key: step.key,
        position: step.position,
        semantics: step.semantics,
        status: step.status,
        attempt: step.attempt,
        payload: step.payload,
        errorCode: step.errorCode,
      })),
    };
  },

  async extendLease(runId, until) {
    await prisma.workflowRun.updateMany({ where: { id: runId, status: "RUNNING" }, data: { leaseExpiresAt: until } });
  },

  async markStepInFlight(stepId, now) {
    await prisma.workflowStep.update({
      where: { id: stepId },
      data: { status: "IN_FLIGHT", startedAt: now, attempt: { increment: 1 } },
    });
  },

  async completeStep(stepId, completion, now) {
    const done = completion.status === "SUCCESS" || completion.status === "SKIPPED";
    await prisma.workflowStep.update({
      where: { id: stepId },
      data: {
        status: completion.status,
        ...(completion.status === "PENDING" ? {} : { completedAt: now }),
        ...(completion.status === "PENDING" || completion.status === "FAILED" ? { attempt: { increment: 1 } } : {}),
        // Input is only needed to execute the step; drop it once it can never run again.
        ...(done ? { payload: Prisma.DbNull } : {}),
        ...(completion.result ? { result: completion.result as Prisma.InputJsonValue } : {}),
        ...(completion.externalId ? { externalId: completion.externalId.slice(0, 200) } : {}),
        errorCode: completion.error?.code ?? null,
        errorMessage: completion.error?.userMessage ?? null,
      },
    });
  },

  async scheduleRetry(runId, at, error, options) {
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        leaseExpiresAt: null,
        nextRetryAt: at,
        errorCode: error.code,
        errorMessage: error.userMessage,
        ...(options?.refundAttempt ? { attempt: { decrement: 1 } } : {}),
      },
    });
  },

  async finish(runId, status, error, now) {
    const run = await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status,
        leaseExpiresAt: null,
        nextRetryAt: null,
        finishedAt: now,
        errorCode: error?.code ?? null,
        errorMessage: error?.userMessage ?? null,
        // The run input carries message content; it is not needed once finished.
        ...(status === "FAILED" ? {} : { input: Prisma.DbNull }),
      },
      select: { startedAt: true },
    });
    if (run.startedAt) {
      await prisma.workflowRun.update({
        where: { id: runId },
        data: { durationMs: Math.max(0, now.getTime() - run.startedAt.getTime()) },
      });
    }
  },
};

export interface NewStep {
  key: string;
  idempotencyKey: string;
  semantics?: DeliverySemantics;
  payload?: Prisma.InputJsonValue;
}

export interface NewRun {
  userId: string;
  kind: WorkflowKind;
  idempotencyKey: string;
  title: string;
  subjectType?: string;
  subjectId?: string;
  input?: Prisma.InputJsonValue;
  trigger?: RunTrigger;
  scheduledFor?: Date;
  steps: NewStep[];
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/**
 * Creates a run with its steps in one transaction. A duplicate idempotency key
 * (the same event, reminder day or feed item seen twice) returns the existing
 * run instead, so producers can enqueue blindly.
 */
export async function createRunIfAbsent(run: NewRun): Promise<{ id: string; created: boolean }> {
  try {
    const created = await prisma.workflowRun.create({
      data: {
        userId: run.userId,
        kind: run.kind,
        idempotencyKey: run.idempotencyKey,
        title: run.title.slice(0, 200),
        subjectType: run.subjectType,
        subjectId: run.subjectId,
        input: run.input,
        trigger: run.trigger ?? "SCHEDULED",
        scheduledFor: run.scheduledFor,
        steps: {
          create: run.steps.map((step, position) => ({
            key: step.key,
            idempotencyKey: step.idempotencyKey,
            position,
            semantics: step.semantics ?? "AT_LEAST_ONCE",
            payload: step.payload,
          })),
        },
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.workflowRun.findUnique({
      where: { idempotencyKey: run.idempotencyKey },
      select: { id: true },
    });
    if (!existing) throw error;
    return { id: existing.id, created: false };
  }
}
