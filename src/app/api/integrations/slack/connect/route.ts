import { NextResponse, type NextRequest } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { getAppUrl } from "@/lib/env";
import { issueOAuthState } from "@/lib/oauth-state";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/rbac";
import { buildSlackAuthorizeUrl } from "@/lib/slack/oauth";
import { isSlackConfigured } from "@/services/slack-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts Slack OAuth v2, requesting bot and "Post as me" user scopes together. */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  try {
    const user = await authorize("integration:slack:manage:own");
    if (!isSlackConfigured()) return NextResponse.redirect(`${appUrl}/settings?slack=not_configured`);

    const limit = await rateLimit(`slack:connect:${user.userId}`, RATE_LIMITS.integrationConnect);
    if (!limit.success) return NextResponse.redirect(`${appUrl}/settings?slack=rate_limited`);

    const state = await issueOAuthState(
      "slack",
      user.userId,
      request.nextUrl.searchParams.get("returnTo") ?? "/settings",
    );
    return NextResponse.redirect(buildSlackAuthorizeUrl(state));
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.redirect(`${appUrl}/login`);
    return handleApiError(error, "integrations/slack/connect");
  }
}
