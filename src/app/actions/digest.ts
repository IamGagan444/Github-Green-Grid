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
  addDigestSource,
  deleteDigestSource,
  requestDigestNow,
  saveDigestSettings,
  setDigestSourceEnabled,
} from "@/services/digest-service";

/**
 * Morning digest mutations. Each action authenticates, authorizes,
 * rate-limits and validates on its own: Server Actions are public endpoints.
 */

const asArray = (value: unknown) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

async function digestUser() {
  const user = await authorize("notification:manage:own");
  await enforceRateLimit(`digest:write:${user.userId}`, RATE_LIMITS.automationWrite);
  return user;
}

function refresh() {
  revalidatePath("/digest");
  revalidatePath("/dashboard");
}

export async function saveDigestSettingsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:digest/settings", async () => {
    const user = await digestUser();
    const fields = formFields(formData);
    await saveDigestSettings(user, {
      enabled: fields.enabled === "on",
      time: fields.time,
      timezone: fields.timezone,
      daysOfWeek: asArray(fields.daysOfWeek),
      channelIds: asArray(fields.channelIds),
    });
    refresh();
    return fields.enabled === "on" ? "Saved. Your digest will arrive at the time you picked." : "Saved. The digest is paused.";
  });
}

const sourceSchema = z.object({
  kind: z.enum(["RSS", "YOUTUBE_CHANNEL", "GITHUB_RELEASES", "HACKER_NEWS"]),
  value: z.string().max(2_000).default(""),
  label: z.string().max(60).optional(),
});

export async function addDigestSourceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:digest/source-add", async () => {
    const user = await digestUser();
    await addDigestSource(user, sourceSchema.parse(formFields(formData)));
    refresh();
    return "Source added.";
  });
}

const idSchema = z.object({ id: idParamSchema });
const toggleSchema = z.object({ id: idParamSchema, enabled: z.enum(["true", "false"]) });

export async function toggleDigestSourceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:digest/source-toggle", async () => {
    const user = await digestUser();
    const { id, enabled } = toggleSchema.parse(formFields(formData));
    await setDigestSourceEnabled(user, id, enabled === "true");
    refresh();
    return enabled === "true" ? "Source turned back on." : "Source paused.";
  });
}

export async function deleteDigestSourceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:digest/source-delete", async () => {
    const user = await digestUser();
    await deleteDigestSource(user, idSchema.parse(formFields(formData)).id);
    refresh();
    return "Source removed.";
  });
}

export async function sendDigestNowAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  return runAction("action:digest/send-now", async () => {
    const user = await authorize("notification:manage:own");
    await enforceRateLimit(`digest:now:${user.userId}`, RATE_LIMITS.automationTest);
    const outcome = await requestDigestNow(user.userId);
    refresh();
    switch (outcome) {
      case "queued":
        return "Sent. Check your channels.";
      case "too_soon":
        throw new AppError("INTERNAL", "digest requested too soon", { userMessage: "You just got one. Try again in a few minutes." });
      case "no_sources":
        throw new AppError("INTERNAL", "digest has no sources", { userMessage: "Add a source first." });
      default:
        throw new AppError("INTERNAL", "digest not configured", { userMessage: "Save your schedule and channels first." });
    }
  });
}
