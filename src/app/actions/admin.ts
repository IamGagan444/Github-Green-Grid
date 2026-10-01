"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/lib/actions/action-state";
import { formFields, runAction } from "@/lib/actions/run-action";
import { authorize, enforceRateLimit } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema } from "@/validators/automation";
import { setUserStatus } from "@/services/admin-service";
import { adminSetAutomationDisabled } from "@/services/automation-service";

const userStatusSchema = z.object({ id: idParamSchema, status: z.enum(["ACTIVE", "DISABLED"]) });
const automationStatusSchema = z.object({ id: idParamSchema, disabled: z.enum(["true", "false"]) });

export async function setUserStatusAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:admin/users/status", async () => {
    const admin = await authorize("user:manage");
    await enforceRateLimit(`admin:write:${admin.userId}`, RATE_LIMITS.adminWrite);
    const { id, status } = userStatusSchema.parse(formFields(formData));
    await setUserStatus(admin, id, status);
    revalidatePath("/admin", "layout");
    return status === "DISABLED" ? "User disabled." : "User enabled.";
  });
}

export async function setAutomationDisabledAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:admin/automations/status", async () => {
    const admin = await authorize("automation:manage:all");
    await enforceRateLimit(`admin:write:${admin.userId}`, RATE_LIMITS.adminWrite);
    const { id, disabled } = automationStatusSchema.parse(formFields(formData));
    const disable = disabled === "true";
    await adminSetAutomationDisabled(admin, id, disable, disable ? "Disabled by an administrator." : null);
    revalidatePath("/admin", "layout");
    return disable ? "Automation disabled." : "Automation enabled (paused).";
  });
}
