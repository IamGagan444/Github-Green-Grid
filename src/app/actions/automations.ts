"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "@/lib/actions/action-state";
import { formFields, runAction } from "@/lib/actions/run-action";
import { authorize, enforceRateLimit } from "@/lib/api";
import { MANUAL_SLOT_PREFIX, MAX_RUNS_PER_DAY } from "@/lib/automation/schedule";
import { AppError } from "@/lib/errors";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/rbac";
import { idParamSchema } from "@/validators/automation";
import {
  deleteAutomation,
  getAutomationForActor,
  setAutomationPaused,
  todayFor,
} from "@/services/automation-service";
import { countRunsForDay, runAutomation } from "@/services/execution-service";

const idSchema = z.object({ id: idParamSchema });
const pauseSchema = z.object({ id: idParamSchema, action: z.enum(["pause", "resume"]) });

/** Pause or resume. Pausing never touches configuration or history. */
export async function setAutomationPausedAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:automation/status", async () => {
    const user = await authorize("automation:pause:own");
    await enforceRateLimit(`automation:write:${user.userId}`, RATE_LIMITS.automationWrite);
    const { id, action } = pauseSchema.parse(formFields(formData));
    await setAutomationPaused(user, id, action === "pause");
    revalidatePath("/", "layout");
    return action === "pause" ? "Automation paused. Configuration kept." : "Automation resumed.";
  });
}

export async function deleteAutomationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runAction("action:automation/delete", async () => {
    const user = await authorize("automation:delete:own");
    await enforceRateLimit(`automation:write:${user.userId}`, RATE_LIMITS.automationWrite);
    const { id } = idSchema.parse(formFields(formData));
    await deleteAutomation(user, id);
    return "Automation deleted.";
  });
  if (result.status !== "success") return result;

  revalidatePath("/", "layout");
  redirect("/automations?notice=automation_deleted");
}

/**
 * "Run now": posts an update for real, covering commits since the previous
 * post today. Scheduled posts continue from where it ended, so nothing is
 * repeated. Capped at MAX_RUNS_PER_DAY posts per automation per day.
 */
export async function runAutomationNowAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  let destination: string | null = null;

  const result = await runAction("action:automation/run", async () => {
    const user = await authorize("automation:execute:own");
    await enforceRateLimit(`automation:run:${user.userId}`, RATE_LIMITS.automationRun);
    const { id } = idSchema.parse(formFields(formData));

    const automation = await getAutomationForActor(user, id);
    // Admin read access does not extend to executing someone else's automation.
    if (automation.userId !== user.userId) throw new AuthorizationError("NOT_FOUND");
    if (automation.status === "DISABLED") throw new AppError("AUTOMATION_NOT_ACTIVE");

    const executionDate = todayFor(automation);
    if ((await countRunsForDay(id, executionDate)) >= MAX_RUNS_PER_DAY) {
      throw new AppError("DUPLICATE_EXECUTION", "daily run limit reached", {
        userMessage: `This automation already posted ${MAX_RUNS_PER_DAY} times today. Try again tomorrow.`,
      });
    }

    // "Same day": each Run now is its own post covering commits since the last
    // one. "Previous day" recaps yesterday once, so it shares the day's slot.
    const slot =
      automation.commitWindow === "PREVIOUS_DAY"
        ? (automation.scheduleTimes[0] ?? "00:00")
        : `${MANUAL_SLOT_PREFIX}${Date.now()}`;

    const outcome = await runAutomation({
      automationId: id,
      executionDate,
      slot,
      trigger: "MANUAL",
      actorUserId: user.userId,
    });

    if (outcome.status === "NOOP") {
      throw new AppError(outcome.reason === "in_progress" ? "EXECUTION_IN_PROGRESS" : "DUPLICATE_EXECUTION");
    }
    if (outcome.executionId) {
      const notice = outcome.status === "SUCCESS" ? "run_success" : outcome.status === "SKIPPED" ? "run_skipped" : "run_failed";
      destination = `/executions/${outcome.executionId}?notice=${notice}`;
    }
    return outcome.status === "FAILED" ? outcome.message : "Run finished.";
  });

  revalidatePath("/", "layout");
  if (destination) redirect(destination);
  return result;
}
