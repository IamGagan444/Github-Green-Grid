"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "@/lib/actions/action-state";
import { formFields, runAction } from "@/lib/actions/run-action";
import { authorize, enforceRateLimit } from "@/lib/api";
import { signOut } from "@/lib/auth/config";
import { prisma } from "@/lib/db";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { settingsSchema } from "@/lib/validation/schemas";
import { idParamSchema } from "@/validators/automation";
import { disconnectGitHub } from "@/services/github-service";
import { disconnectSlack } from "@/services/slack-service";

/** Updates automation defaults. */
export async function saveSettingsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:settings/save", async () => {
    const user = await authorize("settings:manage:own");
    await enforceRateLimit(`settings:${user.userId}`, RATE_LIMITS.settingsWrite);

    const fields = formFields(formData);
    const days = fields.defaultDaysOfWeek;
    const input = settingsSchema.parse({
      ...fields,
      defaultDaysOfWeek: days === undefined ? [] : Array.isArray(days) ? days : [days],
    });

    await prisma.user.update({
      where: { id: user.userId },
      data: {
        defaultTimezone: input.defaultTimezone,
        defaultCommitMessage: input.defaultCommitMessage,
        ...(input.defaultScheduleTime ? { defaultScheduleTime: input.defaultScheduleTime } : {}),
        ...(input.defaultDaysOfWeek ? { defaultDaysOfWeek: input.defaultDaysOfWeek } : {}),
        ...(input.defaultMessageStyle ? { defaultMessageStyle: input.defaultMessageStyle } : {}),
      },
    });
    revalidatePath("/", "layout");
    return "Automation defaults saved.";
  });
}

/** Disconnects GitHub. History and automation configuration are preserved. */
export async function disconnectGitHubAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  return runAction("action:integrations/github/disconnect", async () => {
    const user = await authorize("integration:github:manage:own");
    await enforceRateLimit(`github:disconnect:${user.userId}`, RATE_LIMITS.integrationConnect);
    await disconnectGitHub(user.userId);
    revalidatePath("/", "layout");
    return "GitHub disconnected.";
  });
}

export async function disconnectSlackAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:integrations/slack/disconnect", async () => {
    const user = await authorize("integration:slack:manage:own");
    await enforceRateLimit(`slack:disconnect:${user.userId}`, RATE_LIMITS.integrationConnect);
    const { id } = z.object({ id: idParamSchema }).parse(formFields(formData));
    await disconnectSlack(user.userId, id);
    revalidatePath("/", "layout");
    return "Slack workspace disconnected.";
  });
}

/**
 * Deletes the account: revokes GitHub and Slack grants at the providers, then
 * deletes the user and everything they own, and ends the session.
 */
export async function deleteAccountAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  const result = await runAction("action:account/delete", async () => {
    const user = await authorize("settings:manage:own");
    await enforceRateLimit(`settings:${user.userId}`, RATE_LIMITS.settingsWrite);

    await disconnectGitHub(user.userId);
    const workspaces = await prisma.slackIntegration.findMany({
      where: { userId: user.userId, status: "CONNECTED" },
      select: { id: true },
    });
    for (const workspace of workspaces) await disconnectSlack(user.userId, workspace.id);

    await prisma.user.delete({ where: { id: user.userId } });
    await signOut({ redirect: false });
    return "Your account was deleted.";
  });
  if (result.status !== "success") return result;
  redirect("/");
}
