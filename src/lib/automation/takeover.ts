import type { ClaimResult } from "@/lib/automation/types";
import type { RunStatus, RunTrigger } from "@/generated/prisma/enums";

export interface TakeoverCandidate {
  status: RunStatus;
  attempt: number;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
  slackReplyTs: string | null;
}

/**
 * Decides whether an existing execution row for the same automation/day may be
 * claimed by a new worker. Pure — shared by the Prisma store and tests.
 *
 *  - SUCCESS (or any row with a posted reply) is terminal.
 *  - RUNNING with a live lease belongs to another worker; an expired lease
 *    means that worker died, so the run is resumed.
 *  - SKIPPED (nothing posted) may be re-run manually, not by the scheduler.
 *  - FAILED is retried by the scheduler only when retryable, under the attempt
 *    cap and after its backoff; a manual run may always retry it.
 */
export function evaluateTakeover(
  existing: TakeoverCandidate,
  trigger: RunTrigger,
  now: Date,
  maxAttempts: number,
): "takeover" | Exclude<ClaimResult["kind"], "claimed"> {
  if (existing.status === "SUCCESS" || existing.slackReplyTs) return "already_done";

  if (existing.status === "RUNNING") {
    const leaseValid = existing.leaseExpiresAt !== null && existing.leaseExpiresAt.getTime() > now.getTime();
    return leaseValid ? "in_progress" : "takeover";
  }

  if (existing.status === "SKIPPED") {
    return trigger === "MANUAL" ? "takeover" : "already_done";
  }

  if (trigger === "MANUAL") return "takeover";
  if (existing.nextRetryAt === null || existing.attempt >= maxAttempts) return "not_retryable";
  return existing.nextRetryAt.getTime() <= now.getTime() ? "takeover" : "retry_not_due";
}
