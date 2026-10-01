"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/lib/actions/action-state";
import { formFields, runAction } from "@/lib/actions/run-action";
import { ApiError, requireApiUser } from "@/lib/api";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { deleteSchedule, updateSchedule } from "@/lib/services/schedules";

const scheduleIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

async function limitScheduleWrites(userId: string, kind: "update" | "delete"): Promise<void> {
  const limit = await rateLimit(`schedules:${kind}:${userId}`, RATE_LIMITS.scheduleWrite);
  if (!limit.success) throw new ApiError("RATE_LIMITED", "Too many schedule changes. Try again shortly.");
}

export async function setScheduleEnabledAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:schedules/toggle", async () => {
    const user = await requireApiUser();
    await limitScheduleWrites(user.userId, "update");
    const { id, enabled } = z
      .object({ id: scheduleIdSchema, enabled: z.enum(["true", "false"]) })
      .parse(formFields(formData));
    await updateSchedule(user.userId, id, { enabled: enabled === "true" });
    revalidatePath("/dashboard", "layout");
    return enabled === "true" ? "Automation resumed." : "Automation paused.";
  });
}

export async function deleteScheduleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:schedules/delete", async () => {
    const user = await requireApiUser();
    await limitScheduleWrites(user.userId, "delete");
    const { id } = z.object({ id: scheduleIdSchema }).parse(formFields(formData));
    await deleteSchedule(user.userId, id);
    revalidatePath("/dashboard", "layout");
    return "Schedule deleted.";
  });
}
