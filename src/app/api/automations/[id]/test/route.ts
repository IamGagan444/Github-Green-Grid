import { NextResponse, type NextRequest } from "next/server";

import { assertSameOrigin, authorize, enforceRateLimit, handleApiError } from "@/lib/api";
import { AuthorizationError } from "@/lib/rbac";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema } from "@/validators/automation";
import { getAutomationForActor, previewAutomation } from "@/services/automation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Test of a saved automation: real data, posted to Slack as a labelled test. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await authorize("automation:test:own");
    await enforceRateLimit(`automation:test:${user.userId}`, RATE_LIMITS.automationTest);
    const id = idParamSchema.parse((await context.params).id);

    const automation = await getAutomationForActor(user, id);
    if (automation.userId !== user.userId) throw new AuthorizationError("NOT_FOUND");
    if (!automation.slackIntegrationId) throw new AuthorizationError("NOT_FOUND", "Select a Slack workspace first.");

    const preview = await previewAutomation(
      user,
      {
        githubSources: automation.githubSources,
        commitWindow: automation.commitWindow,
        messageStyle: automation.messageStyle,
        quickNote: automation.quickNote,
        includeFileStats: automation.includeFileStats,
        slackIntegrationId: automation.slackIntegrationId,
        slackChannelId: automation.slackChannelId,
        postingMode: automation.postingMode,
        threadMode: automation.threadMode,
        headerFormat: automation.headerFormat,
        timezone: automation.timezone,
      },
      id,
    );
    return NextResponse.json({ preview });
  } catch (error) {
    return handleApiError(error, "automation/test");
  }
}
