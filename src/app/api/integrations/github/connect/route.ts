import { NextResponse, type NextRequest } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { getAppUrl } from "@/lib/env";
import { buildAuthorizeUrl } from "@/lib/github/oauth";
import { issueOAuthState } from "@/lib/oauth-state";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts the GitHub App authorization for the signed-in user. */
export async function GET(request: NextRequest) {
  try {
    const user = await authorize("integration:github:manage:own");

    const limit = await rateLimit(`github:connect:${user.userId}`, RATE_LIMITS.integrationConnect);
    if (!limit.success) return NextResponse.redirect(`${getAppUrl()}/settings?github=rate_limited`);

    const state = await issueOAuthState(
      "github",
      user.userId,
      request.nextUrl.searchParams.get("returnTo") ?? "/settings",
    );
    return NextResponse.redirect(buildAuthorizeUrl(state));
  } catch (error) {
    if (error instanceof Error && error.name === "AuthorizationError") {
      return NextResponse.redirect(`${getAppUrl()}/login`);
    }
    return handleApiError(error, "integrations/github/connect");
  }
}
