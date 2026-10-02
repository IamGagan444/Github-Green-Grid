import { getDueRuns, type AutomationTiming, type DueRun } from "@/lib/automation/schedule";
import { AppError } from "@/lib/errors";

export interface SchedulableAutomation extends AutomationTiming {
  id: string;
}

/** All runs of one automation due now, oldest first. They must execute in order. */
export interface DueItem {
  automationId: string;
  runs: DueRun[];
}

/**
 * Pure selection of automations due at `now`. An automation with a corrupt
 * timezone or time is reported, not thrown, so it cannot stall the whole batch.
 */
export function selectDueAutomations(
  automations: readonly SchedulableAutomation[],
  now: Date,
  graceMinutes?: number,
): { due: DueItem[]; invalid: string[] } {
  const due: DueItem[] = [];
  const invalid: string[] = [];

  for (const automation of automations) {
    try {
      const runs = getDueRuns(automation, now, graceMinutes);
      if (runs.length > 0) due.push({ automationId: automation.id, runs });
    } catch (error) {
      if (error instanceof AppError && error.code === "TIMEZONE_INVALID") invalid.push(automation.id);
      else throw error;
    }
  }

  // Most overdue automations first.
  due.sort((a, b) => (a.runs[0]?.scheduledFor.getTime() ?? 0) - (b.runs[0]?.scheduledFor.getTime() ?? 0));
  return { due, invalid };
}

/** Runs `worker` over `items` with bounded concurrency until the deadline. */
export async function runWithBudget<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  options: { concurrency: number; deadline: number; now?: () => number },
): Promise<{ started: number; deferred: number }> {
  const now = options.now ?? Date.now;
  let index = 0;
  let started = 0;

  async function lane() {
    while (index < items.length && now() < options.deadline) {
      const item = items[index] as T;
      index += 1;
      started += 1;
      await worker(item);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, lane));
  return { started, deferred: items.length - started };
}
