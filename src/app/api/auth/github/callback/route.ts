import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/env";
import { exchangeOAuthCode } from "@/lib/github/github-client";
import { fetchProfileWithToken } from "@/lib/github/github-user";
import { getRedirectUri } from "@/lib/github/oauth";
import { createLogger } from "@/lib/logging/logger";
import { consumeOAuthState } from "@/lib/oauth-state";
import { connectGitHub } from "@/services/github-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("github-callback");

/**
 * GitHub App authorization callback. This path is kept at
 * /api/auth/github/callback so the callback URL registered on existing GitHub
 * Apps keeps working; it now *connects an integration* for the signed-in user
 * rather than signing anyone in.
 */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl}/login`);

  const params = request.nextUrl.searchParams;
  const check = await consumeOAuthState("github", params.get("state"), user.userId);
  const back = (status: string) => {
    const url = new URL(check.returnTo, appUrl);
    url.searchParams.set("github", status);
    return NextResponse.redirect(url);
  };

  if (params.get("error")) return back("access_denied");
  if (!check.valid) return back(check.reason);

  const code = params.get("code");
  if (!code) return back("invalid_request");

  try {
    const tokens = await exchangeOAuthCode(code, getRedirectUri());
    const profile = await fetchProfileWithToken(tokens.accessToken);
    const outcome = await connectGitHub(user.userId, profile, tokens);
    return back(outcome === "linked_elsewhere" ? "linked_elsewhere" : "connected");
  } catch (error) {
    log.error("GitHub connection failed", { error: error as Error });
    return back("connection_failed");
  }
}
