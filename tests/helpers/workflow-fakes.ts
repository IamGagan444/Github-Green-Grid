import type { DeliverySemantics, WorkflowKind, WorkflowStepStatus } from "@/generated/prisma/enums";
import type { AppError } from "@/lib/errors";
import { MAX_ATTEMPTS } from "@/lib/workflow/engine";
import type { ClaimedRun, RunStore, StepCompletion, StepHandler, WorkflowEngineDeps } from "@/lib/workflow/types";

/**
 * In-memory RunStore with the same claim semantics as the Prisma store:
 * a run is claimable when RUNNING, under the attempt cap, unleased (or the
 * lease expired) and due.
 */

export interface MemoryStep {
  id: string;
  key: string;
  position: number;
  semantics: DeliverySemantics;
  status: WorkflowStepStatus;
  attempt: number;
  payload: unknown;
  errorCode: string | null;
  externalId: string | null;
}

export interface MemoryRun {
  id: string;
  userId: string;
  kind: WorkflowKind;
  idempotencyKey: string;
  title: string;
  input: unknown;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  attempt: number;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
  errorCode: string | null;
  steps: MemoryStep[];
}

export class MemoryRunStore implements RunStore {
  readonly runs = new Map<string, MemoryRun>();
  /** Simulates a worker crash right after a provider call returned. */
  failNextComplete = false;

  add(run: {
    id: string;
    userId?: string;
    kind?: WorkflowKind;
    input?: unknown;
    steps: Array<{ key: string; semantics?: DeliverySemantics; payload?: unknown; status?: WorkflowStepStatus }>;
  }): MemoryRun {
    const created: MemoryRun = {
      id: run.id,
      userId: run.userId ?? "user-1",
      kind: run.kind ?? "NOTIFY",
      idempotencyKey: `key:${run.id}`,
      title: "Test run",
      input: run.input ?? null,
      status: "RUNNING",
      attempt: 0,
      leaseExpiresAt: null,
      nextRetryAt: null,
      errorCode: null,
      steps: run.steps.map((step, position) => ({
        id: `${run.id}:${step.key}`,
        key: step.key,
        position,
        semantics: step.semantics ?? "AT_LEAST_ONCE",
        status: step.status ?? "PENDING",
        attempt: 0,
        payload: step.payload ?? null,
        errorCode: null,
        externalId: null,
      })),
    };
    this.runs.set(created.id, created);
    return created;
  }

  step(runId: string, key: string): MemoryStep {
    const step = this.runs.get(runId)?.steps.find((entry) => entry.key === key);
    if (!step) throw new Error(`no step ${key}`);
    return step;
  }

  async claim(runId: string, leaseMs: number, now: Date): Promise<ClaimedRun | null> {
    const run = this.runs.get(runId);
    if (!run || run.status !== "RUNNING" || run.attempt >= MAX_ATTEMPTS) return null;
    if (run.leaseExpiresAt && run.leaseExpiresAt > now) return null;
    if (run.nextRetryAt && run.nextRetryAt > now) return null;
    run.leaseExpiresAt = new Date(now.getTime() + leaseMs);
    run.attempt += 1;
    run.nextRetryAt = null;
    return {
      id: run.id,
      userId: run.userId,
      kind: run.kind,
      idempotencyKey: run.idempotencyKey,
      title: run.title,
      input: run.input,
      attempt: run.attempt,
      steps: run.steps.map((step) => ({ ...step })),
    };
  }

  async extendLease(runId: string, until: Date) {
    const run = this.runs.get(runId)!;
    run.leaseExpiresAt = until;
  }

  async markStepInFlight(stepId: string) {
    const step = this.findStep(stepId);
    step.status = "IN_FLIGHT";
    step.attempt += 1;
  }

  async completeStep(stepId: string, completion: StepCompletion) {
    if (this.failNextComplete) {
      this.failNextComplete = false;
      throw new Error("simulated crash while saving the step");
    }
    const step = this.findStep(stepId);
    step.status = completion.status;
    step.errorCode = completion.error?.code ?? null;
    if (completion.externalId) step.externalId = completion.externalId;
    if (completion.status === "SUCCESS" || completion.status === "SKIPPED") step.payload = null;
  }

  async scheduleRetry(runId: string, at: Date, error: AppError, options?: { refundAttempt?: boolean }) {
    const run = this.runs.get(runId)!;
    run.leaseExpiresAt = null;
    run.nextRetryAt = at;
    run.errorCode = error.code;
    if (options?.refundAttempt) run.attempt -= 1;
  }

  async finish(runId: string, status: "SUCCESS" | "FAILED" | "SKIPPED", error: AppError | null) {
    const run = this.runs.get(runId)!;
    run.status = status;
    run.leaseExpiresAt = null;
    run.nextRetryAt = null;
    run.errorCode = error?.code ?? null;
  }

  private findStep(stepId: string): MemoryStep {
    for (const run of this.runs.values()) {
      const step = run.steps.find((entry) => entry.id === stepId);
      if (step) return step;
    }
    throw new Error(`no step ${stepId}`);
  }
}

/** Mutable clock for tests. */
export function fakeClock(start = new Date("2026-10-16T08:00:00Z")) {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
    set(date: Date) {
      current = date.getTime();
    },
  };
}

export function engineDeps(
  store: MemoryRunStore,
  handlers: Record<string, StepHandler>,
  clock: { now: () => Date },
  onPermanent: WorkflowEngineDeps["onPermanentStepFailure"] = undefined,
): WorkflowEngineDeps {
  return {
    store,
    now: clock.now,
    handlerFor: (_run, step) => {
      const handler = handlers[step.key];
      if (!handler) throw new Error(`no handler for ${step.key}`);
      return handler;
    },
    onPermanentStepFailure: onPermanent,
  };
}
