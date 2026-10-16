import { after, NextResponse, type NextRequest } from "next/server";

import { ConfigurationError, getTelegramConfig } from "@/lib/env";
import { createLogger } from "@/lib/logging/logger";
import { isTelegramWebhookAuthorised, telegramUpdateSchema } from "@/lib/telegram/bot";
import { processTelegramUpdate } from "@/services/telegram-service";

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

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return NextResponse.json({ ok: true });

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
