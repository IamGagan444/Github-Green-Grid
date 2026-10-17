"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/lib/actions/action-state";
import { formFields, runAction } from "@/lib/actions/run-action";
import { authorize, enforceRateLimit } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema } from "@/validators/automation";
import {
  addReceivable,
  deleteReceivable,
  saveReminderSettings,
  sendReminderNow,
  setReceivableStatus,
} from "@/services/reminder-service";

/**
 * Payment reminder mutations. Each action authenticates, authorizes,
 * rate-limits and validates on its own: Server Actions are public endpoints.
 */

const asArray = (value: unknown) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

async function reminderUser() {
  const user = await authorize("notification:manage:own");
  await enforceRateLimit(`reminders:write:${user.userId}`, RATE_LIMITS.automationWrite);
  return user;
}

function refresh() {
  revalidatePath("/reminders");
}

export async function saveReminderSettingsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:reminders/settings", async () => {
    const user = await reminderUser();
    const fields = formFields(formData);
    await saveReminderSettings(user, { ...fields, enabled: fields.enabled === "on", channelIds: asArray(fields.channelIds) });
    refresh();
    return "Saved.";
  });
}

export async function addReceivableAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:reminders/add", async () => {
    const user = await reminderUser();
    await addReceivable(user, formFields(formData));
    refresh();
    return "Added. Reminders start on the due date.";
  });
}

const statusSchema = z.object({ id: idParamSchema, status: z.enum(["OPEN", "PAID", "CANCELLED"]) });

export async function setReceivableStatusAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:reminders/status", async () => {
    const user = await reminderUser();
    const { id, status } = statusSchema.parse(formFields(formData));
    await setReceivableStatus(user, id, status);
    refresh();
    return status === "PAID" ? "Marked as paid. No more reminders." : status === "CANCELLED" ? "Cancelled. No more reminders." : "Reopened.";
  });
}

const idSchema = z.object({ id: idParamSchema });

export async function deleteReceivableAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:reminders/delete", async () => {
    const user = await reminderUser();
    await deleteReceivable(user, idSchema.parse(formFields(formData)).id);
    refresh();
    return "Deleted.";
  });
}

export async function remindNowAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:reminders/now", async () => {
    const user = await authorize("notification:manage:own");
    await enforceRateLimit(`reminders:now:${user.userId}`, RATE_LIMITS.automationTest);
    const outcome = await sendReminderNow(user, idSchema.parse(formFields(formData)).id);
    refresh();
    if (outcome === "too_soon") throw new AppError("INTERNAL", "reminder too soon", { userMessage: "You just reminded them. Try again in a few minutes." });
    if (outcome === "nothing_to_send") {
      throw new AppError("INTERNAL", "nowhere to send", { userMessage: "Connect Gmail or pick a channel in Settings so the reminder has somewhere to go." });
    }
    return "Reminder sent.";
  });
}
