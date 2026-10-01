import "server-only";

import { MAX_ATTEMPTS } from "@/lib/automation/engine";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging/logger";
import { runWithBudget, selectDueAutomations, type DueItem } from "@/lib/scheduler/due";
import { runAutomation } from "@/services/execution-service";

const log = createLogger("scheduler");

export interface SchedulerSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  retried: number;
  deferred: number;
  invalid: number;
}

const CONCURRENCY = 3;
/** Leave headroom under the platform's function timeout. */
const TIME_BUDGET_MS = 45_000;

/**
 * One scheduler tick:
 *  1. Load ACTIVE automations whose owner is ACTIVE and whose GitHub and Slack
 *     integrations are CONNECTED (disconnected integrations stop execution).
 *  2. Select every schedule time due now in its own timezone and weekday.
 *  3. Add failed executions whose retry time has arrived.
 *  4. Execute with bounded concurrency across automations (each automation's
 *     runs in order) inside a time budget. Anything not reached is picked up
 *     by the next tick — idempotency keys make that safe.
 */
export async function processDueAutomations(now: Date = new Date()): Promise<SchedulerSummary> {
  const cronRun = await prisma.cronRun.create({ data: { job: "standups", startedAt: now }, select: { id: true } });
  const summary: SchedulerSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    retried: 0,
    deferred: 0,
    invalid: 0,
  };

  try {
    const eligible = await prisma.automation.findMany({
      where: {
        status: "ACTIVE",
        user: { status: "ACTIVE", githubIntegration: { status: "CONNECTED" } },
        slackIntegration: { status: "CONNECTED" },
      },
      select: { id: true, daysOfWeek: true, scheduleTimes: true, timezone: true },
    });

    const { due, invalid } = selectDueAutomations(eligible, now);
    summary.invalid = invalid.length;
    if (invalid.length > 0) log.warn("automations with invalid schedule skipped", { automationIds: invalid });

    const retries = await prisma.execution.findMany({
      where: {
        status: "FAILED",
        nextRetryAt: { lte: now },
        attempt: { lt: MAX_ATTEMPTS },
        // Rows from before multiple times per day have no slot and are not retried.
        slot: { not: null },
        automation: {
          status: "ACTIVE",
          user: { status: "ACTIVE", githubIntegration: { status: "CONNECTED" } },
          slackIntegration: { status: "CONNECTED" },
        },
      },
      select: { automationId: true, executionDate: true, slot: true, scheduledFor: true, trigger: true },
      take: 50,
    });

    // One work item per automation so its runs never execute concurrently.
    const work = new Map<string, Array<DueItem["runs"][number] & { retry: boolean; trigger: "SCHEDULED" | "MANUAL" }>>();
    const seen = new Set<string>();
    for (const item of due) {
      work.set(item.automationId, item.runs.map((run) => ({ ...run, retry: false, trigger: "SCHEDULED" as const })));
      for (const run of item.runs) seen.add(`${item.automationId}:${run.executionDate}:${run.slot}`);
    }
    for (const retry of retries) {
      if (!retry.automationId || !retry.slot) continue;
      const key = `${retry.automationId}:${retry.executionDate}:${retry.slot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const runs = work.get(retry.automationId) ?? [];
      runs.push({
        executionDate: retry.executionDate,
        slot: retry.slot,
        scheduledFor: retry.scheduledFor ?? now,
        retry: true,
        trigger: retry.trigger === "MANUAL" ? "MANUAL" : "SCHEDULED",
      });
      work.set(retry.automationId, runs);
    }

    const items = [...work.entries()].map(([automationId, runs]) => ({
      automationId,
      runs: runs.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime()),
    }));

    const { deferred } = await runWithBudget(
      items,
      async (item) => {
        for (const run of item.runs) {
          summary.processed += 1;
          if (run.retry) summary.retried += 1;
          try {
            const outcome = await runAutomation({
              automationId: item.automationId,
              executionDate: run.executionDate,
              slot: run.slot,
              trigger: run.trigger,
              scheduledFor: run.scheduledFor,
              actorUserId: null,
            });
            if (outcome.status === "SUCCESS") summary.succeeded += 1;
            else if (outcome.status === "FAILED") summary.failed += 1;
            else summary.skipped += 1;
          } catch (error) {
            // One run's failure never aborts the batch.
            summary.failed += 1;
            log.error("automation run threw", { automationId: item.automationId, slot: run.slot, error: error as Error });
          }
        }
      },
      { concurrency: CONCURRENCY, deadline: now.getTime() + TIME_BUDGET_MS },
    );
    summary.deferred = deferred;

    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: {
        finishedAt: new Date(),
        processed: summary.processed,
        succeeded: summary.succeeded,
        failed: summary.failed,
        skipped: summary.skipped,
      },
    });
    return summary;
  } catch (error) {
    await prisma.cronRun
      .update({
        where: { id: cronRun.id },
        data: { finishedAt: new Date(), error: error instanceof Error ? error.name : "unknown" },
      })
      .catch(() => undefined);
    throw error;
  }
}
