import { getDueRun, type AutomationTiming, type DueRun } from "@/lib/automation/schedule";
import { AppError } from "@/lib/errors";

export interface SchedulableAutomation extends AutomationTiming {
  id: string;
}

export interface DueItem extends DueRun {
  automationId: string;
}

/**
 * Pure selection of automations due at `now`. An automation with a corrupt
 * timezone is reported, not thrown, so it cannot stall the whole batch.
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
      const run = getDueRun(automation, now, graceMinutes);
      if (run) due.push({ automationId: automation.id, ...run });
    } catch (error) {
      if (error instanceof AppError && error.code === "TIMEZONE_INVALID") invalid.push(automation.id);
      else throw error;
    }
  }

  due.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
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
