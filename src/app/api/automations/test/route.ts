import { NextResponse, type NextRequest } from "next/server";

import { assertSameOrigin, authorize, enforceRateLimit, handleApiError, readJson } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { previewAutomationSchema } from "@/validators/automation";
import { previewAutomation } from "@/services/automation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Test of an unsaved configuration from the wizard, posted to Slack as a labelled test. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await authorize("automation:test:own");
    await enforceRateLimit(`automation:test:${user.userId}`, RATE_LIMITS.automationTest);
    const input = await readJson(request, previewAutomationSchema);
    return NextResponse.json({ preview: await previewAutomation(user, input) });
  } catch (error) {
    return handleApiError(error, "automations/test");
  }
}
