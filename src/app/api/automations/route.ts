import { NextResponse, type NextRequest } from "next/server";

import { assertSameOrigin, authorize, enforceRateLimit, handleApiError, readJson } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createAutomationSchema } from "@/validators/automation";
import { createAutomation, listAutomationsForUser } from "@/services/automation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await authorize("automation:read:own");
    return NextResponse.json({ automations: await listAutomationsForUser(user.userId) });
  } catch (error) {
    return handleApiError(error, "automations:GET");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await authorize("automation:create:own");
    await enforceRateLimit(`automation:write:${user.userId}`, RATE_LIMITS.automationWrite);
    const { activate, ...config } = await readJson(request, createAutomationSchema);
    const created = await createAutomation(user, config, activate);
    return NextResponse.json({ automation: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "automations:POST");
  }
}
