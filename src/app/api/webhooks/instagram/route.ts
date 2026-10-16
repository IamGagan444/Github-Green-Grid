import { after, NextResponse, type NextRequest } from "next/server";

import { clientIp, readBodyText } from "@/lib/api";
import { safeCompare } from "@/lib/encryption";
import { getInstagramConfig } from "@/lib/env";
import { verifyMetaSignature } from "@/lib/instagram/signature";
import { normaliseWebhook, webhookEnvelopeSchema } from "@/lib/instagram/webhook";
import { createLogger } from "@/lib/logging/logger";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
import { ingestInstagramEvents, runInstagramEvents } from "@/services/instagram-event-service";
import { isInstagramConfigured } from "@/services/instagram-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const log = createLogger("instagram-webhook");

const MAX_BODY_BYTES = 256 * 1024;
/** Work done after the response, inside the function's lifetime. */
const AFTER_BUDGET_MS = 45_000;

/** Meta's subscription handshake: echo `hub.challenge` when the verify token matches. */
export async function GET(request: NextRequest) {
  if (!isInstagramConfigured()) return new NextResponse(null, { status: 503 });
  const expected = getInstagramConfig().webhookVerifyToken;
  const params = request.nextUrl.searchParams;
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (params.get("hub.mode") !== "subscribe" || !expected || !token || !challenge || !safeCompare(expected, token)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(challenge.slice(0, 200), { status: 200, headers: { "Content-Type": "text/plain" } });
}

/**
 * Event delivery. The signature is verified over the raw body before parsing.
 * Matching events are stored (idempotently) and acknowledged immediately;
 * sending happens after the response so Meta's timeout is never hit. Anything
 * unfinished is picked up by /api/cron/instagram.
 */
export async function POST(request: NextRequest) {
  const limit = await rateLimit(`instagram-webhook:${clientIp(request)}`, RATE_LIMITS.instagramWebhook);
  if (!limit.success) return NextResponse.json({ ok: false }, { status: 429, headers: rateLimitHeaders(limit) });

  if (!isInstagramConfigured()) return NextResponse.json({ ok: false }, { status: 503 });
  const { appSecret } = getInstagramConfig();

  const rawBody = await readBodyText(request, MAX_BODY_BYTES).catch(() => null);
  if (rawBody === null) return NextResponse.json({ ok: false }, { status: 413 });

  const valid = verifyMetaSignature({
    appSecret,
    signature: request.headers.get("x-hub-signature-256"),
    rawBody,
  });
  if (!valid) return NextResponse.json({ ok: false }, { status: 401 });

  let events;
  try {
    events = normaliseWebhook(webhookEnvelopeSchema.parse(JSON.parse(rawBody)));
  } catch {
    // Malformed or unknown payloads are acknowledged so Meta does not retry them.
    return NextResponse.json({ ok: true });
  }
  if (events.length === 0) return NextResponse.json({ ok: true });

  // A storage failure returns 500 so Meta redelivers; duplicates are absorbed.
  let stored;
  try {
    stored = await ingestInstagramEvents(events);
  } catch (error) {
    log.error("instagram webhook ingest failed", { error: error as Error });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (stored.length > 0) {
    after(async () => {
      const summary = await runInstagramEvents(stored, { deadline: Date.now() + AFTER_BUDGET_MS });
      log.info("instagram events processed", { ...summary });
    });
  }
  return NextResponse.json({ ok: true });
}
