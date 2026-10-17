import { NextResponse, type NextRequest } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { getAppUrl } from "@/lib/env";
import { buildLinkedInAuthorizeUrl, isLinkedInConfigured } from "@/lib/linkedin/client";
import { issueOAuthState } from "@/lib/oauth-state";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts "Connect LinkedIn" (OpenID identity plus w_member_social to post as the member). */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  try {
    const user = await authorize("integration:linkedin:manage:own");
    if (!isLinkedInConfigured()) return NextResponse.redirect(`${appUrl}/settings/connections?linkedin=not_configured`);
    const limit = await rateLimit(`linkedin:connect:${user.userId}`, RATE_LIMITS.integrationConnect);
    if (!limit.success) return NextResponse.redirect(`${appUrl}/settings/connections?linkedin=rate_limited`);

    const state = await issueOAuthState("linkedin", user.userId, request.nextUrl.searchParams.get("returnTo") ?? "/settings/connections");
    return NextResponse.redirect(buildLinkedInAuthorizeUrl(state));
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.redirect(`${appUrl}/login`);
    return handleApiError(error, "integrations/linkedin/connect");
  }
}
