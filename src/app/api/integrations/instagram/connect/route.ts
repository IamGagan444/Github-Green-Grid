import { NextResponse, type NextRequest } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { getAppUrl } from "@/lib/env";
import { buildInstagramAuthorizeUrl } from "@/lib/instagram/oauth";
import { issueOAuthState } from "@/lib/oauth-state";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/rbac";
import { isInstagramConfigured } from "@/services/instagram-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts Business Login for Instagram. */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  try {
    const user = await authorize("integration:instagram:manage:own");
    if (!isInstagramConfigured()) return NextResponse.redirect(`${appUrl}/settings?instagram=not_configured`);

    const limit = await rateLimit(`instagram:connect:${user.userId}`, RATE_LIMITS.integrationConnect);
    if (!limit.success) return NextResponse.redirect(`${appUrl}/settings?instagram=rate_limited`);

    const state = await issueOAuthState(
      "instagram",
      user.userId,
      request.nextUrl.searchParams.get("returnTo") ?? "/settings",
    );
    return NextResponse.redirect(buildInstagramAuthorizeUrl(state));
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.redirect(`${appUrl}/login`);
    return handleApiError(error, "integrations/instagram/connect");
  }
}
