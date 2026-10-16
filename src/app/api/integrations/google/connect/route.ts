import { NextResponse, type NextRequest } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { getAppUrl } from "@/lib/env";
import { buildGoogleAuthorizeUrl } from "@/lib/google/oauth";
import { issueOAuthState } from "@/lib/oauth-state";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts "Connect Google" (Sheets via drive.file, Gmail via gmail.send). */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  try {
    const user = await authorize("integration:google:manage:own");
    const limit = await rateLimit(`google:connect:${user.userId}`, RATE_LIMITS.integrationConnect);
    if (!limit.success) return NextResponse.redirect(`${appUrl}/settings/connections?google=rate_limited`);

    const state = await issueOAuthState(
      "google",
      user.userId,
      request.nextUrl.searchParams.get("returnTo") ?? "/settings/connections",
    );
    return NextResponse.redirect(buildGoogleAuthorizeUrl(state, user.email));
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.redirect(`${appUrl}/login`);
    return handleApiError(error, "integrations/google/connect");
  }
}
