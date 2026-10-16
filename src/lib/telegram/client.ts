import "server-only";

import { ConfigurationError, getTelegramConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Minimal Telegram Bot API client. The bot token is part of the request URL
 * (Telegram's design), so URLs built here are never logged.
 */

const API = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 15_000;

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export function isTelegramConfigured(): boolean {
  try {
    getTelegramConfig();
    return true;
  } catch (error) {
    if (error instanceof ConfigurationError) return false;
    throw error;
  }
}

export async function callTelegram<T>(method: string, params: Record<string, unknown>): Promise<T> {
  let token: string;
  try {
    token = getTelegramConfig().botToken;
  } catch (error) {
    if (error instanceof ConfigurationError) throw new AppError("CONFIGURATION_MISSING", error.message);
    throw error;
  }

  let response: Response;
  try {
    response = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("CHANNEL_DELIVERY_FAILED", `telegram ${method}: network error or timeout`);
  }

  let payload: TelegramResponse<T>;
  try {
    payload = (await response.json()) as TelegramResponse<T>;
  } catch {
    throw new AppError("CHANNEL_DELIVERY_FAILED", `telegram ${method}: non-JSON response ${response.status}`);
  }
  if (payload.ok && payload.result !== undefined) return payload.result;
  throw telegramError(method, response.status, payload);
}

/** Maps Bot API failures onto the delivery error classes the engine understands. */
export function telegramError(method: string, status: number, payload: TelegramResponse<unknown>): AppError {
  const code = payload.error_code ?? status;
  const description = (payload.description ?? "").slice(0, 200);
  if (code === 429) {
    const retryAfter = payload.parameters?.retry_after ?? 5;
    return new AppError("CHANNEL_RATE_LIMITED", `telegram ${method}: 429`, { retryAfterMs: retryAfter * 1000 });
  }
  // 403: bot blocked, kicked, or user deactivated. 400 "chat not found": chat gone.
  if (code === 403 || (code === 400 && /chat not found|user is deactivated|bot was kicked|have no rights/i.test(description))) {
    return new AppError("CHANNEL_UNAVAILABLE", `telegram ${method}: ${code} ${description}`);
  }
  if (code === 401 || code === 404) {
    return new AppError("CONFIGURATION_MISSING", `telegram ${method}: bot token rejected (${code})`);
  }
  if (code >= 500) return new AppError("CHANNEL_DELIVERY_FAILED", `telegram ${method}: ${code}`);
  return new AppError("CHANNEL_UNAVAILABLE", `telegram ${method}: ${code} ${description}`);
}

export interface SendMessageInput {
  chatId: string;
  html: string;
  replyMarkup?: unknown;
}

export async function sendTelegramMessage(input: SendMessageInput): Promise<{ messageId: number }> {
  const result = await callTelegram<{ message_id: number }>("sendMessage", {
    chat_id: input.chatId,
    text: input.html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
  });
  return { messageId: result.message_id };
}

export async function answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
  await callTelegram("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text.slice(0, 190) });
}

export function telegramStartLink(token: string): string {
  return `https://t.me/${getTelegramConfig().botUsername}?start=${token}`;
}
