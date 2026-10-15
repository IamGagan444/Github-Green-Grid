import { NextResponse, type NextRequest } from "next/server";

import { assertSameOrigin, authorize, enforceRateLimit, handleApiError, readJson } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema } from "@/validators/automation";
import { instagramAutomationSchema } from "@/validators/instagram";
import { updateInstagramAutomation } from "@/services/instagram-automation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await authorize("automation:update:own");
    await enforceRateLimit(`automation:write:${user.userId}`, RATE_LIMITS.automationWrite);
    const id = idParamSchema.parse((await context.params).id);
    const input = await readJson(request, instagramAutomationSchema);
    await updateInstagramAutomation(user, id, input);
    return NextResponse.json({ automation: { id } });
  } catch (error) {
    return handleApiError(error, "instagram/automations:PUT");
  }
}
