import { AppError, appErrorFromCode, toAppError } from "@/lib/errors";
import {
  NotPerformedError,
  type ClaimedRun,
  type ClaimedStep,
  type RunOutcome,
  type WorkflowEngineDeps,
} from "@/lib/workflow/types";

/**
 * Generic, resumable workflow execution (hub notifications, form submissions,
 * reminders, digests, cross-posts).
 *
 * Guarantees, all enforced here so every automation inherits them:
 *  - A run is processed by one worker at a time (lease taken by `claim`).
 *  - A step that SUCCEEDED or was SKIPPED is never executed again.
 *  - AT_LEAST_ONCE steps retry on transient errors with backoff.
 *  - AT_MOST_ONCE steps are marked IN_FLIGHT before the side effect. If the
 *    worker dies, or the provider's answer is ambiguous, the step becomes
 *    UNKNOWN and is never retried — a 2xx is never followed by a second post.
 *  - Permanent failures stop retries; quota waits do not consume attempts.
 */

export const MAX_ATTEMPTS = 5;
export const LEASE_MS = 2 * 60_000;

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export function retryDelayMs(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1)] ?? 60_000;
}

type Pending = { step: ClaimedStep; error: AppError };

export async function processRun(deps: WorkflowEngineDeps, runId: string): Promise<RunOutcome> {
  const clock = deps.now ?? (() => new Date());
  const run = await deps.store.claim(runId, LEASE_MS, clock());
  if (!run) return "BUSY";

  const results = new Map<string, Record<string, unknown>>();
  const retryable: Pending[] = [];
  const failed: Pending[] = [];
  let quotaWait: AppError | null = null;
  let blocked = false;
  let delivered = run.steps.some((step) => step.status === "SUCCESS");

  const steps = [...run.steps].sort((a, b) => a.position - b.position);

  for (const step of steps) {
    if (step.status === "SUCCESS" || step.status === "SKIPPED") continue;
    if (step.status === "FAILED" || step.status === "UNKNOWN") {
      failed.push({ step, error: appErrorFromCode(step.status === "UNKNOWN" ? "STEP_OUTCOME_UNKNOWN" : step.errorCode) });
      continue;
    }

    // A previous worker died between "about to post" and "posted".
    if (step.status === "IN_FLIGHT" && step.semantics === "AT_MOST_ONCE") {
      const error = new AppError("STEP_OUTCOME_UNKNOWN", `step ${step.key} was in flight when its worker stopped`);
      await deps.store.completeStep(step.id, { status: "UNKNOWN", error }, clock());
      failed.push({ step, error });
      await deps.onPermanentStepFailure?.(run, step, error);
      continue;
    }

    if (blocked) {
      await deps.store.completeStep(step.id, { status: "SKIPPED" }, clock());
      continue;
    }

    const handler = deps.handlerFor(run, step);
    await deps.store.extendLease(run.id, new Date(clock().getTime() + LEASE_MS));
    if (step.semantics === "AT_MOST_ONCE") await deps.store.markStepInFlight(step.id, clock());

    // Only the provider call is guarded. A failure to *record* a result must
    // propagate: the lease then expires, and an AT_MOST_ONCE step left
    // IN_FLIGHT becomes UNKNOWN instead of being sent again.
    let output: Awaited<ReturnType<typeof handler.run>> | null = null;
    let thrown: unknown = null;
    try {
      output = await handler.run({ run, step, results, now: clock() });
    } catch (error) {
      thrown = error ?? new Error("step failed");
    }

    if (output) {
      await deps.store.completeStep(
        step.id,
        { status: output.status ?? "SUCCESS", result: output.result ?? null, externalId: output.externalId ?? null },
        clock(),
      );
      if (output.result) results.set(step.key, output.result);
      if ((output.status ?? "SUCCESS") === "SUCCESS") delivered = true;
      continue;
    }

    const notPerformed = thrown instanceof NotPerformedError;
    const error = toAppError(notPerformed ? (thrown as NotPerformedError).error : thrown, `workflow:${run.kind}:${step.key}`);

    if (step.semantics === "AT_MOST_ONCE" && !notPerformed && error.retryable) {
      // Ambiguous: the request may have reached the provider.
      const unknown = new AppError("STEP_OUTCOME_UNKNOWN", `ambiguous failure in ${step.key}: ${error.code}`);
      await deps.store.completeStep(step.id, { status: "UNKNOWN", error: unknown }, clock());
      failed.push({ step, error: unknown });
      await deps.onPermanentStepFailure?.(run, step, unknown);
    } else if (error.retryable) {
      await deps.store.completeStep(step.id, { status: "PENDING", error }, clock());
      if (error.code === "QUOTA_EXHAUSTED") quotaWait ??= error;
      else retryable.push({ step, error });
    } else {
      await deps.store.completeStep(step.id, { status: "FAILED", error }, clock());
      failed.push({ step, error });
      await deps.onPermanentStepFailure?.(run, step, error);
    }

    if (handler.blocking) blocked = true;
  }

  return settle(deps, run, { retryable, failed, quotaWait, delivered, now: clock() });
}

async function settle(
  deps: WorkflowEngineDeps,
  run: ClaimedRun,
  state: { retryable: Pending[]; failed: Pending[]; quotaWait: AppError | null; delivered: boolean; now: Date },
): Promise<RunOutcome> {
  const { retryable, failed, quotaWait, delivered, now } = state;

  if (quotaWait && retryable.length === 0) {
    const at = new Date(now.getTime() + Math.max(quotaWait.retryAfterMs ?? 0, 60_000));
    await deps.store.scheduleRetry(run.id, at, quotaWait, { refundAttempt: true });
    return "RETRY";
  }

  if (retryable.length > 0) {
    const first = retryable[0]!.error;
    if (run.attempt < MAX_ATTEMPTS) {
      const suggested = Math.max(...retryable.map((entry) => entry.error.retryAfterMs ?? 0));
      const at = new Date(now.getTime() + Math.max(suggested, retryDelayMs(run.attempt)));
      await deps.store.scheduleRetry(run.id, at, first);
      return "RETRY";
    }
    // Out of attempts: the transient failures become permanent.
    for (const entry of retryable) {
      await deps.store.completeStep(entry.step.id, { status: "FAILED", error: entry.error }, now);
      await deps.onPermanentStepFailure?.(run, entry.step, entry.error);
    }
    await deps.store.finish(run.id, "FAILED", first, now);
    return "FAILED";
  }

  if (failed.length > 0) {
    // Prefer an error from this attempt over one recorded by an earlier attempt.
    await deps.store.finish(run.id, "FAILED", failed[failed.length - 1]!.error, now);
    return "FAILED";
  }

  // Nothing was delivered (no targets, or every step had nothing to do).
  const outcome = delivered ? "SUCCESS" : "SKIPPED";
  await deps.store.finish(run.id, outcome, null, now);
  return outcome;
}

/**
 * Orders work round-robin across users so one user's burst (a thousand
 * GitHub events) cannot delay everyone else's messages.
 */
export function interleaveByUser<T extends { userId: string }>(items: readonly T[]): T[] {
  const queues = new Map<string, T[]>();
  for (const item of items) {
    const queue = queues.get(item.userId);
    if (queue) queue.push(item);
    else queues.set(item.userId, [item]);
  }

  const output: T[] = [];
  const lanes = [...queues.values()];
  for (let round = 0; output.length < items.length; round += 1) {
    for (const lane of lanes) {
      const item = lane[round];
      if (item !== undefined) output.push(item);
    }
  }
  return output;
}
