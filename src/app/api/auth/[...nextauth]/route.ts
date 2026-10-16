import { NextResponse, type NextRequest } from "next/server";

import { clientIp } from "@/lib/api";
import { handlers } from "@/lib/auth/config";
import { getAppUrl } from "@/lib/env";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Auth.js endpoints. Starting a sign-in and handling the OAuth callback are
 * rate limited per client IP; session reads and sign-out are not, since the
 * app calls them on normal navigation.
 */
const LIMITED_PATH = /\/api\/auth\/(signin|callback)\//;

async function limited(request: NextRequest, handler: (request: NextRequest) => Promise<Response>) {
  if (LIMITED_PATH.test(request.nextUrl.pathname)) {
    const limit = await rateLimit(`auth:oauth:${clientIp(request)}`, RATE_LIMITS.auth);
    if (!limit.success) {
      const response = NextResponse.redirect(`${getAppUrl()}/login?error=rate_limited`, 303);
      for (const [name, value] of Object.entries(rateLimitHeaders(limit))) response.headers.set(name, value);
      return response;
    }
  }
  return handler(request);
}

export const GET = (request: NextRequest) => limited(request, handlers.GET);
export const POST = (request: NextRequest) => limited(request, handlers.POST);
