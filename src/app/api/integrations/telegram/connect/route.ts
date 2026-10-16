import { NextResponse, type NextRequest } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { getAppUrl } from "@/lib/env";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/rbac";
import { sanitiseReturnTo } from "@/lib/oauth-state";
import { isTelegramConfigured } from "@/lib/telegram/client";
import { createTelegramLink } from "@/services/telegram-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** "Connect Telegram": issues a single-use 15-minute token and opens the bot with it. */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const returnTo = sanitiseReturnTo(request.nextUrl.searchParams.get("returnTo"), "/settings/connections");
  try {
    const user = await authorize("integration:telegram:manage:own");
    if (!isTelegramConfigured()) return NextResponse.redirect(`${appUrl}${returnTo}?telegram=not_configured`);

    const limit = await rateLimit(`telegram:connect:${user.userId}`, RATE_LIMITS.integrationConnect);
    if (!limit.success) return NextResponse.redirect(`${appUrl}${returnTo}?telegram=rate_limited`);

    return NextResponse.redirect(await createTelegramLink(user.userId));
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.redirect(`${appUrl}/login`);
    return handleApiError(error, "integrations/telegram/connect");
  }
}
