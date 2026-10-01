import { NextResponse, type NextRequest } from "next/server";

import { assertSameOrigin, authorize, enforceRateLimit, handleApiError, readJson } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema, updateAutomationSchema } from "@/validators/automation";
import { getAutomationForActor, updateAutomation } from "@/services/automation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const user = await authorize("automation:read:own");
    const id = idParamSchema.parse((await context.params).id);
    return NextResponse.json({ automation: await getAutomationForActor(user, id) });
  } catch (error) {
    return handleApiError(error, "automation:GET");
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await authorize("automation:update:own");
    await enforceRateLimit(`automation:write:${user.userId}`, RATE_LIMITS.automationWrite);
    const id = idParamSchema.parse((await context.params).id);
    const patch = await readJson(request, updateAutomationSchema);
    await updateAutomation(user, id, patch);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, "automation:PATCH");
  }
}
