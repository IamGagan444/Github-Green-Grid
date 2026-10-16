import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { exchangeGoogleCode } from "@/lib/google/oauth";
import { createLogger } from "@/lib/logging/logger";
import { consumeOAuthState } from "@/lib/oauth-state";
import { connectGoogle } from "@/services/google-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("google-callback");

export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl}/login`);

  const params = request.nextUrl.searchParams;
  const check = await consumeOAuthState("google", params.get("state"), user.userId);
  const back = (status: string) => {
    const url = new URL(check.returnTo, appUrl);
    url.searchParams.set("google", status);
    return NextResponse.redirect(url);
  };

  if (params.get("error")) return back("access_denied");
  if (!check.valid) return back(check.reason);

  const code = params.get("code");
  if (!code) return back("invalid_request");

  try {
    await connectGoogle(user.userId, await exchangeGoogleCode(code));
    return back("connected");
  } catch (error) {
    log.error("Google connection failed", {
      code: error instanceof AppError ? error.code : undefined,
      error: error as Error,
    });
    return back("connection_failed");
  }
}
