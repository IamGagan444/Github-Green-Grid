import type { DeliverySemantics, WorkflowKind, WorkflowStepStatus } from "@/generated/prisma/enums";
import type { AppError } from "@/lib/errors";

/**
 * Ports for the generic workflow engine. A run is an ordered list of steps;
 * each step is one external side effect (send a message, append a row, publish
 * a post). The engine records every step before moving on, so a retry resumes
 * exactly where the previous attempt stopped.
 */

export interface ClaimedStep {
  id: string;
  key: string;
  position: number;
  semantics: DeliverySemantics;
  status: WorkflowStepStatus;
  attempt: number;
  payload: unknown;
  errorCode: string | null;
}

export interface ClaimedRun {
  id: string;
  userId: string;
  kind: WorkflowKind;
  idempotencyKey: string;
  title: string;
  input: unknown;
  /** Attempt number of this claim (1 on the first run). */
  attempt: number;
  steps: ClaimedStep[];
}

export interface StepCompletion {
  status: "SUCCESS" | "SKIPPED" | "FAILED" | "UNKNOWN" | "PENDING";
  result?: Record<string, unknown> | null;
  externalId?: string | null;
  error?: AppError | null;
}

export interface RunStore {
  /** Takes the lease on a runnable run; null when finished, not due, or held elsewhere. */
  claim(runId: string, leaseMs: number, now: Date): Promise<ClaimedRun | null>;
  extendLease(runId: string, until: Date): Promise<void>;
  /** Recorded before an AT_MOST_ONCE side effect starts. */
  markStepInFlight(stepId: string, now: Date): Promise<void>;
  completeStep(stepId: string, completion: StepCompletion, now: Date): Promise<void>;
  /** `refundAttempt` keeps quota waits from eating into the retry budget. */
  scheduleRetry(runId: string, at: Date, error: AppError, options?: { refundAttempt?: boolean }): Promise<void>;
  finish(runId: string, status: "SUCCESS" | "FAILED" | "SKIPPED", error: AppError | null, now: Date): Promise<void>;
}

export interface StepContext {
  run: ClaimedRun;
  step: ClaimedStep;
  /** Results of steps that already succeeded in this run, by step key. */
  results: ReadonlyMap<string, Record<string, unknown>>;
  now: Date;
}

export interface StepOutput {
  /** Defaults to SUCCESS. SKIPPED means "nothing to do", never an error. */
  status?: "SUCCESS" | "SKIPPED";
  /** Provider references only (message id, row range, post URN). Never content. */
  result?: Record<string, unknown>;
  externalId?: string | null;
}

export interface StepHandler {
  /**
   * When true, a failure stops the remaining steps (they depend on this one,
   * e.g. a draft before publishing). Otherwise later steps still run, as with
   * independent notification channels.
   */
  blocking?: boolean;
  run(context: StepContext): Promise<StepOutput>;
}

/**
 * Thrown by AT_MOST_ONCE handlers when they know for certain the side effect
 * did not happen (rejected before sending, rate limited). Only then may such a
 * step be retried; any other failure leaves its outcome UNKNOWN.
 */
export class NotPerformedError extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(error.message);
    this.name = "NotPerformedError";
    this.error = error;
  }
}

export interface WorkflowEngineDeps {
  store: RunStore;
  handlerFor(run: ClaimedRun, step: ClaimedStep): StepHandler;
  /** Called once when a step fails for good (e.g. to mark a channel broken). */
  onPermanentStepFailure?(run: ClaimedRun, step: ClaimedStep, error: AppError): Promise<void>;
  now?: () => Date;
}

export type RunOutcome = "SUCCESS" | "FAILED" | "SKIPPED" | "RETRY" | "BUSY";
