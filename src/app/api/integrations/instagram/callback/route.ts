import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { exchangeInstagramCode } from "@/lib/instagram/oauth";
import { createLogger } from "@/lib/logging/logger";
import { consumeOAuthState } from "@/lib/oauth-state";
import { connectInstagram } from "@/services/instagram-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("instagram-callback");

export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl}/login`);

  const params = request.nextUrl.searchParams;
  const check = await consumeOAuthState("instagram", params.get("state"), user.userId);
  const back = (status: string) => {
    const url = new URL(check.returnTo, appUrl);
    url.searchParams.set("instagram", status);
    return NextResponse.redirect(url);
  };

  if (params.get("error")) return back("access_denied");
  if (!check.valid) return back(check.reason);

  const code = params.get("code");
  if (!code) return back("invalid_request");

  try {
    const grant = await exchangeInstagramCode(code);
    await connectInstagram(user.userId, grant);
    return back("connected");
  } catch (error) {
    log.error("Instagram connection failed", { error: error as Error });
    const alreadyLinked =
      error instanceof AppError && error.code === "INSTAGRAM_OAUTH_FAILED" && error.message.includes("another user");
    return back(alreadyLinked ? "already_linked" : "connection_failed");
  }
}
