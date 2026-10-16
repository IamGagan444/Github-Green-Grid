import "server-only";

import { prisma } from "@/lib/db";
import { fingerprint, hashToken, randomToken } from "@/lib/encryption";
import { getTelegramConfig } from "@/lib/env";
import { channelIdentity } from "@/lib/hub/channel-config";
import { createLogger } from "@/lib/logging/logger";
import {
  chatLabel,
  handleTelegramUpdate,
  LINK_TOKEN_TTL_MS,
  type TelegramBotDeps,
  type TelegramUpdate,
} from "@/lib/telegram/bot";
import { answerCallbackQuery, sendTelegramMessage, telegramStartLink } from "@/lib/telegram/client";
import { recordAudit } from "@/services/audit-service";
import { upsertChannel } from "@/services/channel-service";

const log = createLogger("telegram-service");

/** Most outstanding link tokens per user; older ones are simply left to expire. */
const MAX_OPEN_TOKENS = 5;

/**
 * Creates a single-use, 15-minute link token and returns the t.me deep link.
 * Only the token's hash is stored, so a database leak cannot be replayed.
 */
export async function createTelegramLink(userId: string, now = new Date()): Promise<string> {
  const open = await prisma.telegramLinkToken.count({
    where: { userId, consumedAt: null, expiresAt: { gt: now } },
  });
  if (open >= MAX_OPEN_TOKENS) {
    await prisma.telegramLinkToken.deleteMany({ where: { userId, consumedAt: null } });
  }
  const token = randomToken(24);
  await prisma.telegramLinkToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + LINK_TOKEN_TTL_MS) },
  });
  return telegramStartLink(token);
}

function chatRef(chatId: string): string {
  return fingerprint(channelIdentity("TELEGRAM", { chatId, chatType: "private" }));
}

/** Additional behaviour plugged in by later automations (digest on demand, cross-post approvals). */
export interface TelegramExtensions {
  requestDigest?(userId: string): Promise<"queued" | "not_configured">;
  handleCallback?(input: { userIds: string[]; data: string; chatId: string }): Promise<string>;
}

const extensions: TelegramExtensions = {};

export function extendTelegramBot(next: TelegramExtensions): void {
  Object.assign(extensions, next);
}

export function telegramBotDeps(): TelegramBotDeps {
  return {
    botUsername: getTelegramConfig().botUsername,

    async consumeLinkToken(token, now) {
      const tokenHash = hashToken(token);
      // Compare-and-swap: only one /start can consume a token, and only before it expires.
      const { count } = await prisma.telegramLinkToken.updateMany({
        where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (count === 0) return null;
      const row = await prisma.telegramLinkToken.findUnique({
        where: { tokenHash },
        select: { userId: true, user: { select: { status: true } } },
      });
      return row && row.user.status === "ACTIVE" ? row.userId : null;
    },

    async linkChat(userId, chat) {
      const chatId = String(chat.id);
      const id = await upsertChannel(userId, "TELEGRAM", chatLabel(chat), { chatId, chatType: chat.type }, true);
      await recordAudit({
        actorUserId: userId,
        action: "TELEGRAM_CONNECTED",
        targetType: "NotificationChannel",
        targetId: id,
        metadata: { chatType: chat.type },
      });
    },

    async unlinkChat(chatId) {
      const channels = await prisma.notificationChannel.findMany({
        where: { kind: "TELEGRAM", externalRef: chatRef(chatId) },
        select: { id: true, userId: true },
      });
      for (const channel of channels) {
        await prisma.notificationChannel.delete({ where: { id: channel.id } });
        await recordAudit({
          actorUserId: channel.userId,
          action: "TELEGRAM_DISCONNECTED",
          targetType: "NotificationChannel",
          targetId: channel.id,
          metadata: { source: "telegram_stop" },
        });
      }
      return channels.length;
    },

    async usersForChat(chatId) {
      const channels = await prisma.notificationChannel.findMany({
        where: { kind: "TELEGRAM", externalRef: chatRef(chatId), user: { status: "ACTIVE" } },
        select: { userId: true },
      });
      return [...new Set(channels.map((channel) => channel.userId))];
    },

    requestDigest: (userId) => extensions.requestDigest?.(userId) ?? Promise.resolve("not_configured"),

    handleCallback: (input) => extensions.handleCallback?.(input) ?? Promise.resolve("This button is no longer active."),

    async reply(chatId, html) {
      try {
        await sendTelegramMessage({ chatId, html });
      } catch (error) {
        log.warn("telegram reply failed", { error: error as Error });
      }
    },

    async answerCallback(callbackQueryId, text) {
      try {
        await answerCallbackQuery(callbackQueryId, text);
      } catch (error) {
        log.warn("telegram callback answer failed", { error: error as Error });
      }
    },
  };
}

export async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  await handleTelegramUpdate(telegramBotDeps(), update);
}
