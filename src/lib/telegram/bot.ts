import { z } from "zod";

import { safeCompare } from "@/lib/encryption";
import { escapeHtml } from "@/lib/hub/render";

/**
 * Telegram bot logic, independent of storage and HTTP so it can be tested
 * with fakes: webhook authentication, update parsing and the command set
 * (/start <token>, /stop, /digest, /help).
 */

export const LINK_TOKEN_TTL_MS = 15 * 60_000;

/** Telegram echoes the secret given to setWebhook in this header on every call. */
export function isTelegramWebhookAuthorised(expectedSecret: string, header: string | null): boolean {
  return Boolean(header) && safeCompare(expectedSecret, header!);
}

const chatSchema = z.object({
  id: z.number(),
  type: z.enum(["private", "group", "supergroup", "channel"]),
  title: z.string().optional(),
  username: z.string().optional(),
  first_name: z.string().optional(),
});

const fromSchema = z.object({ id: z.number(), username: z.string().optional(), first_name: z.string().optional() });

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      chat: chatSchema,
      from: fromSchema.optional(),
      text: z.string().max(4_096).optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: fromSchema,
      data: z.string().max(64).optional(),
      message: z.object({ message_id: z.number(), chat: chatSchema }).optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramChat = z.infer<typeof chatSchema>;

export interface ParsedCommand {
  command: string;
  argument: string;
}

/** Parses "/cmd arg" and "/cmd@BotName arg"; commands addressed to another bot are ignored. */
export function parseCommand(text: string | undefined, botUsername: string): ParsedCommand | null {
  const match = /^\/([a-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/i.exec((text ?? "").trim());
  if (!match) return null;
  if (match[2] && match[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return { command: match[1]!.toLowerCase(), argument: (match[3] ?? "").trim() };
}

/** Deep-link tokens are base64url; anything else is rejected before touching the database. */
export function isWellFormedLinkToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,64}$/.test(value);
}

export function chatLabel(chat: TelegramChat): string {
  if (chat.type === "private") return chat.username ? `@${chat.username}` : (chat.first_name ?? "Telegram chat");
  return chat.title ?? (chat.username ? `@${chat.username}` : "Telegram group");
}

export interface TelegramBotDeps {
  /** Atomically consumes an unexpired, unused token; returns its owner or null. */
  consumeLinkToken(token: string, now: Date): Promise<string | null>;
  linkChat(userId: string, chat: TelegramChat): Promise<void>;
  /** Removes every channel bound to this chat; returns how many. */
  unlinkChat(chatId: string): Promise<number>;
  /** Users who linked this chat. */
  usersForChat(chatId: string): Promise<string[]>;
  requestDigest(userId: string): Promise<"queued" | "not_configured">;
  handleCallback(input: { userIds: string[]; data: string; chatId: string }): Promise<string>;
  reply(chatId: string, html: string): Promise<void>;
  answerCallback(callbackQueryId: string, text: string): Promise<void>;
  botUsername: string;
  now?: () => Date;
}

export const HELP_TEXT = [
  "<b>GreenGrid bot</b>",
  "",
  "I deliver your GreenGrid notifications here.",
  "",
  "/digest — send today's digest now",
  "/stop — disconnect this chat from GreenGrid",
  "/help — show this message",
  "",
  "To connect, use <b>Connect Telegram</b> in GreenGrid (Settings → Connections).",
].join("\n");

export async function handleTelegramUpdate(deps: TelegramBotDeps, update: TelegramUpdate): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();

  if (update.callback_query) {
    const query = update.callback_query;
    const chatId = query.message ? String(query.message.chat.id) : null;
    if (!chatId || !query.data) {
      await deps.answerCallback(query.id, "This button has expired.");
      return;
    }
    const userIds = await deps.usersForChat(chatId);
    const text = userIds.length === 0 ? "This chat is not connected to GreenGrid." : await deps.handleCallback({ userIds, data: query.data, chatId });
    await deps.answerCallback(query.id, text);
    return;
  }

  const message = update.message;
  if (!message) return;
  const command = parseCommand(message.text, deps.botUsername);
  if (!command) return;
  const chatId = String(message.chat.id);

  switch (command.command) {
    case "start": {
      if (!command.argument) {
        await deps.reply(chatId, HELP_TEXT);
        return;
      }
      const userId = isWellFormedLinkToken(command.argument) ? await deps.consumeLinkToken(command.argument, now) : null;
      if (!userId) {
        await deps.reply(
          chatId,
          "That link has expired or was already used. Open GreenGrid and press <b>Connect Telegram</b> again.",
        );
        return;
      }
      await deps.linkChat(userId, message.chat);
      await deps.reply(
        chatId,
        `✅ Connected to GreenGrid as <b>${escapeHtml(chatLabel(message.chat))}</b>. Notifications you route here will arrive in this chat. Send /stop to disconnect.`,
      );
      return;
    }
    case "stop": {
      const removed = await deps.unlinkChat(chatId);
      await deps.reply(
        chatId,
        removed > 0 ? "Disconnected. GreenGrid will no longer message this chat." : "This chat is not connected to GreenGrid.",
      );
      return;
    }
    case "digest": {
      const userIds = await deps.usersForChat(chatId);
      if (userIds.length === 0) {
        await deps.reply(chatId, "This chat is not connected to GreenGrid.");
        return;
      }
      const outcomes = await Promise.all(userIds.map((userId) => deps.requestDigest(userId)));
      await deps.reply(
        chatId,
        outcomes.includes("queued")
          ? "Building your digest — it will arrive here shortly."
          : "Set up your morning digest in GreenGrid first (Automations → Morning digest).",
      );
      return;
    }
    case "help":
      await deps.reply(chatId, HELP_TEXT);
      return;
    default:
      return;
  }
}
