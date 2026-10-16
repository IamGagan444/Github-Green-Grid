"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/actions/action-state";
import { formFields, runAction } from "@/lib/actions/run-action";
import { authorize, enforceRateLimit } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { deleteAiCredential, saveAiCredential } from "@/services/ai-credential-service";
import { disconnectGoogle } from "@/services/google-service";

export async function saveAiKeyAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction("action:connections/ai-save", async () => {
    const user = await authorize("settings:manage:own");
    // Each save makes a real request to the provider; keep it modest.
    await enforceRateLimit(`ai:save:${user.userId}`, RATE_LIMITS.automationTest);
    await saveAiCredential(user, formFields(formData));
    revalidatePath("/settings/connections");
    return "AI key verified and saved.";
  });
}

export async function deleteAiKeyAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  return runAction("action:connections/ai-delete", async () => {
    const user = await authorize("settings:manage:own");
    await enforceRateLimit(`settings:write:${user.userId}`, RATE_LIMITS.settingsWrite);
    await deleteAiCredential(user);
    revalidatePath("/settings/connections");
    return "AI key removed. AI steps are skipped until you add one.";
  });
}

export async function disconnectGoogleAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  return runAction("action:connections/google-disconnect", async () => {
    const user = await authorize("integration:google:manage:own");
    await enforceRateLimit(`settings:write:${user.userId}`, RATE_LIMITS.settingsWrite);
    await disconnectGoogle(user.userId);
    revalidatePath("/settings/connections");
    return "Google disconnected. Sheets and email steps pause until you reconnect.";
  });
}
