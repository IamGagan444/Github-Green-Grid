import { NextResponse, type NextRequest } from "next/server";

import { clientIp } from "@/lib/api";
import { getInstagramConfig } from "@/lib/env";
import { parseSignedRequest } from "@/lib/instagram/signature";
import { createLogger } from "@/lib/logging/logger";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isInstagramConfigured, markInstagramRevokedByAppScopedId } from "@/services/instagram-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("instagram-deauthorize");

/** Meta calls this when someone removes the app from their Instagram settings. */
export async function POST(request: NextRequest) {
  const limit = await rateLimit(`instagram-deauth:${clientIp(request)}`, RATE_LIMITS.webhook);
  if (!limit.success) return NextResponse.json({ ok: false }, { status: 429 });
  if (!isInstagramConfigured()) return NextResponse.json({ ok: false }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const signed = form?.get("signed_request");
  const payload = parseSignedRequest<{ user_id?: string | number }>(
    typeof signed === "string" ? signed : null,
    getInstagramConfig().appSecret,
  );
  if (!payload?.user_id) return NextResponse.json({ ok: false }, { status: 400 });

  const count = await markInstagramRevokedByAppScopedId(String(payload.user_id));
  log.info("instagram app deauthorized", { integrations: count });
  return NextResponse.json({ ok: true });
}
