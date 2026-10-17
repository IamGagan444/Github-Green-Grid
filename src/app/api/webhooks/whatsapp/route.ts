import { after, NextResponse, type NextRequest } from "next/server";

import { clientIp, readBodyText } from "@/lib/api";
import { safeCompare } from "@/lib/encryption";
import { getWhatsAppConfig } from "@/lib/env";
import { verifyMetaSignature } from "@/lib/instagram/signature";
import { createLogger } from "@/lib/logging/logger";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
import { inboundMessages, whatsAppWebhookSchema } from "@/lib/whatsapp/bot";
import { isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { processWhatsAppMessages } from "@/services/whatsapp-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const log = createLogger("whatsapp-webhook");

const MAX_BODY_BYTES = 256 * 1024;

/** Meta's subscription handshake: echo `hub.challenge` when the verify token matches. */
export async function GET(request: NextRequest) {
  if (!isWhatsAppConfigured()) return new NextResponse(null, { status: 503 });
  const expected = getWhatsAppConfig().webhookVerifyToken;
  const params = request.nextUrl.searchParams;
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (params.get("hub.mode") !== "subscribe" || !token || !challenge || !safeCompare(expected, token)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(challenge.slice(0, 200), { status: 200, headers: { "Content-Type": "text/plain" } });
}

/**
 * Inbound messages (link codes, STOP). The signature is verified over the raw
 * body before parsing; everything authentic is acknowledged with 200 so Meta
 * does not redeliver, and handled after the response.
 */
export async function POST(request: NextRequest) {
  const limit = await rateLimit(`whatsapp-webhook:${clientIp(request)}`, RATE_LIMITS.whatsappWebhook);
  if (!limit.success) return NextResponse.json({ ok: false }, { status: 429, headers: rateLimitHeaders(limit) });

  if (!isWhatsAppConfigured()) return NextResponse.json({ ok: false }, { status: 503 });
  const { appSecret, phoneNumberId } = getWhatsAppConfig();

  const rawBody = await readBodyText(request, MAX_BODY_BYTES).catch(() => null);
  if (rawBody === null) return NextResponse.json({ ok: false }, { status: 413 });

  if (!verifyMetaSignature({ appSecret, signature: request.headers.get("x-hub-signature-256"), rawBody })) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let messages;
  try {
    messages = inboundMessages(whatsAppWebhookSchema.parse(JSON.parse(rawBody)), phoneNumberId);
  } catch {
    // Status updates and payloads we do not handle are acknowledged and dropped.
    return NextResponse.json({ ok: true });
  }

  if (messages.length > 0) {
    after(async () => {
      try {
        await processWhatsAppMessages(messages);
      } catch (error) {
        log.error("whatsapp webhook processing failed", { error: error as Error });
      }
    });
  }
  return NextResponse.json({ ok: true });
}
