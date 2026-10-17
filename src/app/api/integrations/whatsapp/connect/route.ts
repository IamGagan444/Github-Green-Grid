import { NextResponse, type NextRequest } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { getAppUrl } from "@/lib/env";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/rbac";
import { sanitiseReturnTo } from "@/lib/oauth-state";
import { isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { createWhatsAppLink } from "@/services/whatsapp-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** "Connect WhatsApp": issues a single-use 15-minute code and opens WhatsApp with it pre-typed. */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const returnTo = sanitiseReturnTo(request.nextUrl.searchParams.get("returnTo"), "/settings/connections");
  try {
    const user = await authorize("integration:whatsapp:manage:own");
    if (!isWhatsAppConfigured()) return NextResponse.redirect(`${appUrl}${returnTo}?whatsapp=not_configured`);

    const limit = await rateLimit(`whatsapp:connect:${user.userId}`, RATE_LIMITS.integrationConnect);
    if (!limit.success) return NextResponse.redirect(`${appUrl}${returnTo}?whatsapp=rate_limited`);

    return NextResponse.redirect(await createWhatsAppLink(user.userId));
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.redirect(`${appUrl}/login`);
    return handleApiError(error, "integrations/whatsapp/connect");
  }
}
