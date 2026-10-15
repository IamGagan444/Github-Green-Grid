import { NextResponse, type NextRequest } from "next/server";

import { assertSameOrigin, authorize, enforceRateLimit, handleApiError, readJson } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { instagramAutomationSchema } from "@/validators/instagram";
import { createInstagramAutomation } from "@/services/instagram-automation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await authorize("automation:create:own");
    await enforceRateLimit(`automation:write:${user.userId}`, RATE_LIMITS.automationWrite);
    const input = await readJson(request, instagramAutomationSchema);
    const id = await createInstagramAutomation(user, input);
    return NextResponse.json({ automation: { id } }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "instagram/automations:POST");
  }
}
