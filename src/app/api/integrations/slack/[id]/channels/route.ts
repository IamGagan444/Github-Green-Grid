import { NextResponse, type NextRequest } from "next/server";

import { authorize, enforceRateLimit, handleApiError } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema, postingModeSchema } from "@/validators/automation";
import { listWorkspaceChannels } from "@/services/slack-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Channels visible to the posting identity (bot, or the user for "Post as me"). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize("automation:create:own");
    await enforceRateLimit(`slack:channels:${user.userId}`, RATE_LIMITS.integrationRead);
    const id = idParamSchema.parse((await context.params).id);
    const mode = postingModeSchema.parse(request.nextUrl.searchParams.get("mode") ?? "BOT");
    const channels = await listWorkspaceChannels(user.userId, id, mode, {
      refresh: request.nextUrl.searchParams.get("refresh") === "1",
    });
    return NextResponse.json({ channels });
  } catch (error) {
    return handleApiError(error, "integrations/slack/channels");
  }
}
