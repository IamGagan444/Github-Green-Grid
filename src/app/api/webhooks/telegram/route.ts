import { after, NextResponse, type NextRequest } from "next/server";

import { clientIp, readBodyText } from "@/lib/api";
import { ConfigurationError, getTelegramConfig } from "@/lib/env";
import { createLogger } from "@/lib/logging/logger";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
import { isTelegramWebhookAuthorised, telegramUpdateSchema } from "@/lib/telegram/bot";
import { processTelegramUpdate } from "@/services/telegram-service";
// Registers the /digest command handler.
import "@/services/digest-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const log = createLogger("telegram-webhook");

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Telegram bot webhook. Registered with `npm run telegram:set-webhook`, which
 * sets the secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token. Every
 * authenticated update is acknowledged with 200 (Telegram would otherwise
 * redeliver it); handling happens after the response.
 */
export async function POST(request: NextRequest) {
  const limit = await rateLimit(`telegram-webhook:${clientIp(request)}`, RATE_LIMITS.telegramWebhook);
  if (!limit.success) return NextResponse.json({ ok: false }, { status: 429, headers: rateLimitHeaders(limit) });

  let secret: string;
  try {
    secret = getTelegramConfig().webhookSecret;
  } catch (error) {
    if (error instanceof ConfigurationError) return NextResponse.json({ ok: false }, { status: 503 });
    throw error;
  }
  if (!isTelegramWebhookAuthorised(secret, request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Oversized updates are acknowledged and dropped (Telegram would otherwise redeliver them).
  const rawBody = await readBodyText(request, MAX_BODY_BYTES).catch(() => null);
  if (rawBody === null) return NextResponse.json({ ok: true });

  let update;
  try {
    update = telegramUpdateSchema.parse(JSON.parse(rawBody));
  } catch {
    // Updates we do not handle (edited messages, joins, …) are acknowledged and dropped.
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    try {
      await processTelegramUpdate(update);
    } catch (error) {
      log.error("telegram update failed", { updateId: update.update_id, error: error as Error });
    }
  });
  return NextResponse.json({ ok: true });
}
