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
  addCrossPostSource,
  approveCrossPost,
  deleteCrossPostSource,
  rejectCrossPost,
  updateCrossPostSource,
} from "@/services/crosspost-service";
import { disconnectLinkedIn } from "@/services/linkedin-service";

/**
 * Cross-poster mutations. Each action authenticates, authorizes, rate-limits
 * and validates on its own: Server Actions are public endpoints.
 */

const asArray = (value: unknown) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

async function crossPostUser() {
  const user = await authorize("notification:manage:own");
  await enforceRateLimit(`crosspost:write:${user.userId}`, RATE_LIMITS.automationWrite);
  return user;
}

function refresh() {
  revalidatePath("/crosspost");
  revalidatePath("/settings/connections");
}

export async function addCrossPostSourceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:crosspost/add", async () => {
    const user = await crossPostUser();
    const fields = formFields(formData);
    await addCrossPostSource(user, {
      ...fields,
      mode: fields.auto === "on" ? "AUTO" : "APPROVAL",
      linkedin: fields.linkedin === "on",
      channelIds: asArray(fields.channelIds),
    });
    refresh();
    return "Watching it. New posts from now on will be drafted for you.";
  });
}

export async function updateCrossPostSourceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:crosspost/update", async () => {
    const user = await crossPostUser();
    const fields = formFields(formData);
    await updateCrossPostSource(user, idParamSchema.parse(fields.id), {
      mode: fields.auto === "on" ? "AUTO" : "APPROVAL",
      linkedin: fields.linkedin === "on",
      channelIds: asArray(fields.channelIds),
      enabled: fields.enabled === "on",
    });
    refresh();
    return "Saved.";
  });
}

const idSchema = z.object({ id: idParamSchema });

export async function deleteCrossPostSourceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:crosspost/delete", async () => {
    const user = await crossPostUser();
    await deleteCrossPostSource(user, idSchema.parse(formFields(formData)).id);
    refresh();
    return "Stopped watching it.";
  });
}

const approveSchema = z.object({
  id: idParamSchema,
  linkedin: z.string().max(3_000).optional(),
  announcement: z.string().max(1_000).optional(),
});

export async function approveCrossPostAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:crosspost/approve", async () => {
    const user = await crossPostUser();
    const input = approveSchema.parse(formFields(formData));
    const outcome = await approveCrossPost(user.userId, input.id, { linkedin: input.linkedin, announcement: input.announcement });
    refresh();
    if (outcome === "already") throw new AppError("INTERNAL", "already handled", { userMessage: "That one was already handled." });
    if (outcome === "not_found") throw new AppError("INTERNAL", "item missing", { userMessage: "That post no longer exists." });
    return "Approved. Posting now.";
  });
}

export async function rejectCrossPostAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:crosspost/reject", async () => {
    const user = await crossPostUser();
    const done = await rejectCrossPost(user.userId, idSchema.parse(formFields(formData)).id);
    refresh();
    if (!done) throw new AppError("INTERNAL", "already handled", { userMessage: "That one was already handled." });
    return "Rejected. Nothing was posted.";
  });
}

export async function disconnectLinkedInAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  return runAction("action:crosspost/linkedin-disconnect", async () => {
    const user = await authorize("integration:linkedin:manage:own");
    await enforceRateLimit(`crosspost:write:${user.userId}`, RATE_LIMITS.automationWrite);
    await disconnectLinkedIn(user.userId);
    refresh();
    return "LinkedIn disconnected.";
  });
}
