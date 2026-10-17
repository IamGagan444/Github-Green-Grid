import crypto from "node:crypto";

import { z } from "zod";

/**
 * WhatsApp linking logic, independent of storage and HTTP so it can be tested
 * with fakes. A user proves they own a phone by sending a one-time code to the
 * GreenGrid business number; that inbound message also opens WhatsApp's free
 * customer-service window, so the confirmation reply costs nothing.
 */

export const LINK_CODE_TTL_MS = 15 * 60_000;

/** Crockford base32 without the look-alikes I, L, O and U. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 10;
const CODE_PATTERN = /\bGG-?([0-9A-HJKMNP-TV-Z]{10})\b/i;

export function generateLinkCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `GG-${code}`;
}

/** Finds a link code anywhere in a message, normalised to `GG-XXXXXXXXXX`. */
export function extractLinkCode(text: string | undefined): string | null {
  const match = CODE_PATTERN.exec(text ?? "");
  return match ? `GG-${match[1]!.toUpperCase()}` : null;
}

export function linkMessageText(code: string): string {
  return `Link my GreenGrid account: ${code}`;
}

/** wa.me link that opens a chat with the business number, the code already typed. */
export function whatsAppChatLink(businessNumberE164: string, text: string): string {
  return `https://wa.me/${businessNumberE164.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
}

/** WhatsApp ids are the phone number's digits; channels store E.164. */
export function waIdToE164(waId: string): string | null {
  const digits = waId.replace(/\D/g, "");
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}

/** Shows enough of a number to recognise it without exposing it in full. */
export function maskPhone(e164: string): string {
  return e164.length <= 6 ? e164 : `${e164.slice(0, 3)} ••••• ${e164.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook payloads (Cloud API, field "messages")
// ─────────────────────────────────────────────────────────────────────────────

const inboundMessageSchema = z.object({
  from: z.string().max(20),
  id: z.string().max(200),
  type: z.string().max(40),
  text: z.object({ body: z.string().max(4_096) }).optional(),
  button: z.object({ text: z.string().max(200).optional() }).optional(),
});

const changeSchema = z.object({
  field: z.string(),
  value: z.object({
    metadata: z.object({ phone_number_id: z.string().max(40) }).optional(),
    contacts: z.array(z.object({ wa_id: z.string().max(20), profile: z.object({ name: z.string().max(200) }).optional() })).optional(),
    messages: z.array(inboundMessageSchema).max(100).optional(),
  }),
});

export const whatsAppWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({ changes: z.array(changeSchema).max(100) })).max(100),
});

export type WhatsAppWebhook = z.infer<typeof whatsAppWebhookSchema>;

export interface InboundMessage {
  messageId: string;
  phone: string;
  profileName: string | null;
  text: string;
}

/** Text messages (and quick-reply button taps) sent to our number; everything else is ignored. */
export function inboundMessages(payload: WhatsAppWebhook, ownPhoneNumberId: string): InboundMessage[] {
  if (payload.object !== "whatsapp_business_account") return [];
  const out: InboundMessage[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      // One app can serve several numbers; only ours may link channels.
      if (change.value.metadata?.phone_number_id !== ownPhoneNumberId) continue;
      for (const message of change.value.messages ?? []) {
        const phone = waIdToE164(message.from);
        const text = message.text?.body ?? message.button?.text;
        if (!phone || text === undefined) continue;
        const contact = change.value.contacts?.find((candidate) => candidate.wa_id === message.from);
        out.push({ messageId: message.id, phone, profileName: contact?.profile?.name?.trim() || null, text });
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

export interface WhatsAppBotDeps {
  /** Atomically consumes an unexpired, unused code; returns its owner or null. */
  consumeLinkCode(code: string, now: Date): Promise<string | null>;
  linkPhone(userId: string, phone: string, profileName: string | null): Promise<void>;
  /** Removes every channel bound to this phone; returns how many. */
  unlinkPhone(phone: string): Promise<number>;
  reply(phone: string, text: string): Promise<void>;
  now?: () => Date;
}

export const HELP_TEXT = [
  "GreenGrid sends your alerts here.",
  "",
  "To connect, open GreenGrid → Notification hub → Channels → Connect WhatsApp.",
  "Reply STOP to disconnect this number.",
].join("\n");

const STOP_WORDS = /^\s*(stop|unsubscribe|stop all|cancel)\s*[.!]?\s*$/i;

export async function handleWhatsAppMessage(deps: WhatsAppBotDeps, message: InboundMessage): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();

  if (STOP_WORDS.test(message.text)) {
    const removed = await deps.unlinkPhone(message.phone);
    await deps.reply(
      message.phone,
      removed > 0 ? "Disconnected. GreenGrid won't message this number again." : "This number isn't connected to GreenGrid.",
    );
    return;
  }

  const code = extractLinkCode(message.text);
  if (!code) {
    await deps.reply(message.phone, HELP_TEXT);
    return;
  }

  const userId = await deps.consumeLinkCode(code, now);
  if (!userId) {
    await deps.reply(message.phone, "That code has expired or was already used. Open GreenGrid and press Connect WhatsApp again.");
    return;
  }
  await deps.linkPhone(userId, message.phone, message.profileName);
  await deps.reply(message.phone, "✅ Connected to GreenGrid. Alerts you route to WhatsApp will arrive here. Reply STOP to disconnect.");
}
