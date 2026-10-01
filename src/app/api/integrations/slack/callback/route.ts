import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/env";
import { createLogger } from "@/lib/logging/logger";
import { consumeOAuthState } from "@/lib/oauth-state";
import { exchangeSlackCode } from "@/lib/slack/oauth";
import { connectSlack } from "@/services/slack-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("slack-callback");

export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl}/login`);

  const params = request.nextUrl.searchParams;
  const check = await consumeOAuthState("slack", params.get("state"), user.userId);
  const back = (status: string) => {
    const url = new URL(check.returnTo, appUrl);
    url.searchParams.set("slack", status);
    return NextResponse.redirect(url);
  };

  if (params.get("error")) return back("access_denied");
  if (!check.valid) return back(check.reason);

  const code = params.get("code");
  if (!code) return back("invalid_request");

  try {
    const grant = await exchangeSlackCode(code);
    await connectSlack(user.userId, grant);
    return back("connected");
  } catch (error) {
    log.error("Slack connection failed", { error: error as Error });
    return back("connection_failed");
  }
}
