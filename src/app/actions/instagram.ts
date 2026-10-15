"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "@/lib/actions/action-state";
import { formFields, runAction } from "@/lib/actions/run-action";
import { authorize, enforceRateLimit } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema } from "@/validators/automation";
import {
  deleteInstagramAutomation,
  setInstagramAutomationPaused,
} from "@/services/instagram-automation-service";

const idSchema = z.object({ id: idParamSchema });
const pauseSchema = z.object({ id: idParamSchema, action: z.enum(["pause", "resume"]) });

export async function setInstagramAutomationPausedAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("action:instagram-automation/status", async () => {
    const user = await authorize("automation:pause:own");
    await enforceRateLimit(`automation:write:${user.userId}`, RATE_LIMITS.automationWrite);
    const { id, action } = pauseSchema.parse(formFields(formData));
    await setInstagramAutomationPaused(user, id, action === "pause");
    revalidatePath("/instagram", "layout");
    return action === "pause" ? "Automation paused. Nobody gets a DM until you resume it." : "Automation resumed.";
  });
}

export async function deleteInstagramAutomationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction("action:instagram-automation/delete", async () => {
    const user = await authorize("automation:delete:own");
    await enforceRateLimit(`automation:write:${user.userId}`, RATE_LIMITS.automationWrite);
    const { id } = idSchema.parse(formFields(formData));
    await deleteInstagramAutomation(user, id);
    return "Automation deleted.";
  });
  if (result.status !== "success") return result;

  revalidatePath("/instagram", "layout");
  redirect("/instagram?notice=instagram_automation_deleted");
}
