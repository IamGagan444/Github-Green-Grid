import "server-only";

import { prisma } from "@/lib/db";
import { fingerprint, hashToken } from "@/lib/encryption";
import { channelIdentity } from "@/lib/hub/channel-config";
import { createLogger } from "@/lib/logging/logger";
import {
  generateLinkCode,
  handleWhatsAppMessage,
  LINK_CODE_TTL_MS,
  maskPhone,
  type InboundMessage,
  type WhatsAppBotDeps,
} from "@/lib/whatsapp/bot";
import { sendWhatsAppText, whatsAppLinkUrl } from "@/lib/whatsapp/client";
import { recordAudit } from "@/services/audit-service";
import { upsertChannel } from "@/services/channel-service";

const log = createLogger("whatsapp-service");

/** Most outstanding link codes per user; older ones are dropped. */
const MAX_OPEN_CODES = 5;

/**
 * Creates a single-use, 15-minute link code and returns the wa.me link that
 * opens a chat with the business number, code pre-typed. Only the code's hash
 * is stored, so a database leak cannot be replayed.
 */
export async function createWhatsAppLink(userId: string, now = new Date()): Promise<string> {
  const open = await prisma.whatsAppLinkToken.count({
    where: { userId, consumedAt: null, expiresAt: { gt: now } },
  });
  if (open >= MAX_OPEN_CODES) {
    await prisma.whatsAppLinkToken.deleteMany({ where: { userId, consumedAt: null } });
  }
  const code = generateLinkCode();
  await prisma.whatsAppLinkToken.create({
    data: { userId, tokenHash: hashToken(code), expiresAt: new Date(now.getTime() + LINK_CODE_TTL_MS) },
  });
  return whatsAppLinkUrl(code);
}

function phoneRef(phone: string): string {
  return fingerprint(channelIdentity("WHATSAPP", { phone }));
}

export function whatsAppBotDeps(): WhatsAppBotDeps {
  return {
    async consumeLinkCode(code, now) {
      const tokenHash = hashToken(code);
      // Compare-and-swap: only one message can consume a code, and only before it expires.
      const { count } = await prisma.whatsAppLinkToken.updateMany({
        where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (count === 0) return null;
      const row = await prisma.whatsAppLinkToken.findUnique({
        where: { tokenHash },
        select: { userId: true, user: { select: { status: true } } },
      });
      return row && row.user.status === "ACTIVE" ? row.userId : null;
    },

    async linkPhone(userId, phone, profileName) {
      const label = profileName ? `${profileName} (${maskPhone(phone)})` : maskPhone(phone);
      const id = await upsertChannel(userId, "WHATSAPP", label, { phone }, true);
      await recordAudit({ actorUserId: userId, action: "WHATSAPP_CONNECTED", targetType: "NotificationChannel", targetId: id });
    },

    async unlinkPhone(phone) {
      const channels = await prisma.notificationChannel.findMany({
        where: { kind: "WHATSAPP", externalRef: phoneRef(phone) },
        select: { id: true, userId: true },
      });
      for (const channel of channels) {
        await prisma.notificationChannel.delete({ where: { id: channel.id } });
        await recordAudit({
          actorUserId: channel.userId,
          action: "WHATSAPP_DISCONNECTED",
          targetType: "NotificationChannel",
          targetId: channel.id,
          metadata: { source: "whatsapp_stop" },
        });
      }
      return channels.length;
    },

    async reply(phone, text) {
      try {
        // The user just messaged us, so this falls inside the free 24-hour window.
        await sendWhatsAppText({ to: phone, text });
      } catch (error) {
        log.warn("whatsapp reply failed", { error: error as Error });
      }
    },
  };
}

export async function processWhatsAppMessages(messages: InboundMessage[]): Promise<void> {
  const deps = whatsAppBotDeps();
  for (const message of messages) {
    try {
      await handleWhatsAppMessage(deps, message);
    } catch (error) {
      log.error("whatsapp message failed", { messageId: message.messageId, error: error as Error });
    }
  }
}
