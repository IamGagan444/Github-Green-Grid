import { NextResponse, type NextRequest } from "next/server";

import { clientIp } from "@/lib/api";
import { randomToken } from "@/lib/encryption";
import { getAppUrl, getInstagramConfig } from "@/lib/env";
import { parseSignedRequest } from "@/lib/instagram/signature";
import { createLogger } from "@/lib/logging/logger";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
import { deleteInstagramDataByAppScopedId, isInstagramConfigured } from "@/services/instagram-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("instagram-data-deletion");

/**
 * Meta data-deletion callback. Deletion is synchronous, so the status URL
 * always reports completion for any well-formed confirmation code.
 */
export async function POST(request: NextRequest) {
  const limit = await rateLimit(`instagram-deletion:${clientIp(request)}`, RATE_LIMITS.webhook);
  if (!limit.success) return NextResponse.json({ ok: false }, { status: 429, headers: rateLimitHeaders(limit) });
  if (!isInstagramConfigured()) return NextResponse.json({ ok: false }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const signed = form?.get("signed_request");
  const payload = parseSignedRequest<{ user_id?: string | number }>(
    typeof signed === "string" ? signed : null,
    getInstagramConfig().appSecret,
  );
  if (!payload?.user_id) return NextResponse.json({ ok: false }, { status: 400 });

  const count = await deleteInstagramDataByAppScopedId(String(payload.user_id));
  const code = randomToken(12);
  log.info("instagram data deleted", { integrations: count });

  return NextResponse.json({
    url: `${getAppUrl()}/api/instagram/data-deletion?code=${encodeURIComponent(code)}`,
    confirmation_code: code,
  });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code || !/^[A-Za-z0-9_-]{8,64}$/.test(code)) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json({
    confirmation_code: code,
    status: "completed",
    message: "All Instagram data GreenGrid stored for this account has been deleted.",
  });
}
