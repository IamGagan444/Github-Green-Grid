import { NextResponse, type NextRequest } from "next/server";

import { randomToken } from "@/lib/encryption";
import { buildAuthorizeUrl, sanitiseReturnTo } from "@/lib/github/oauth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { setOAuthStateCookie } from "@/lib/session";
import { getAppUrl } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts the GitHub OAuth flow with a single-use, cookie-bound state value. */
export async function GET(request: NextRequest) {
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await rateLimit(`auth:start:${clientIp}`, RATE_LIMITS.auth);
  if (!limit.success) {
    return NextResponse.redirect(`${getAppUrl()}/login?error=rate_limited`);
  }

  const state = randomToken(24);
  const returnTo = sanitiseReturnTo(request.nextUrl.searchParams.get("returnTo"));

  await setOAuthStateCookie(state, returnTo);

  return NextResponse.redirect(buildAuthorizeUrl(state));
}
