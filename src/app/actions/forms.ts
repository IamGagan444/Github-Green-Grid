"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/lib/actions/action-state";
import { formFields, runAction } from "@/lib/actions/run-action";
import { authorize, enforceRateLimit } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema } from "@/validators/automation";
import { createForm, deleteForm, setFormStatus, updateForm } from "@/services/form-service";

/**
 * Form mutations. Each action authenticates, authorizes, rate-limits and
 * validates on its own: Server Actions are public endpoints.
 */

const asArray = (value: unknown) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

async function formUser() {
  const user = await authorize("notification:manage:own");
  await enforceRateLimit(`forms:write:${user.userId}`, RATE_LIMITS.automationWrite);
  return user;
}

function refresh(formId?: string) {
  revalidatePath("/forms");
  if (formId) revalidatePath(`/forms/${formId}`);
}

/** The editor posts the field list as JSON; everything else is plain form data. */
function readInput(formData: FormData) {
  const fields = formFields(formData);
  let parsedFields: unknown;
  try {
    parsedFields = JSON.parse(typeof fields.fields === "string" ? fields.fields : "[]");
  } catch {
    throw new AppError("INTERNAL", "fields json invalid", { userMessage: "The field list couldn't be read. Reload and try again." });
  }
  const origins = typeof fields.allowedOrigins === "string" ? fields.allowedOrigins : "";
  return {
    name: fields.name,
    fields: parsedFields,
    thankYouMessage: fields.thankYouMessage,
    ackEnabled: fields.ackEnabled === "on",
    ackSubject: typeof fields.ackSubject === "string" ? fields.ackSubject : undefined,
    ackBody: typeof fields.ackBody === "string" ? fields.ackBody : undefined,
    allowedOrigins: origins
      .split(/[\s,]+/)
      .map((origin) => origin.trim())
      .filter(Boolean),
    channelIds: asArray(fields.channelIds),
  };
}

export async function createFormAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:forms/create", async () => {
    const user = await formUser();
    await createForm(user, readInput(formData));
    refresh();
    return "Form created, with a new Google Sheet for its responses.";
  });
}

export async function updateFormAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:forms/update", async () => {
    const user = await formUser();
    const id = idParamSchema.parse(formFields(formData).id);
    await updateForm(user, id, readInput(formData));
    refresh(id);
    return "Saved.";
  });
}

const toggleSchema = z.object({ id: idParamSchema, active: z.enum(["true", "false"]) });

export async function toggleFormAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:forms/toggle", async () => {
    const user = await formUser();
    const { id, active } = toggleSchema.parse(formFields(formData));
    await setFormStatus(user, id, active === "true");
    refresh(id);
    return active === "true" ? "Form is accepting responses again." : "Form paused. The link now shows it's closed.";
  });
}

export async function deleteFormAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:forms/delete", async () => {
    const user = await formUser();
    await deleteForm(user, idParamSchema.parse(formFields(formData).id));
    refresh();
    return "Form deleted. Its Google Sheet stays in your Drive.";
  });
}
