import { z } from "zod";

import type { ChannelKind } from "@/generated/prisma/enums";

/**
 * Per-kind channel configuration. Stored encrypted (it contains the Discord
 * webhook secret, chat ids, phone numbers and addresses) and validated on every read.
 */

export const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d{5,30}\/[A-Za-z0-9_-]{20,200}$/;

export const emailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/, "Enter a valid email address");

export const channelConfigSchemas = {
  TELEGRAM: z.object({
    chatId: z.string().regex(/^-?\d{1,20}$/),
    chatType: z.enum(["private", "group", "supergroup", "channel"]),
  }),
  DISCORD_WEBHOOK: z.object({
    webhookUrl: z.string().trim().regex(DISCORD_WEBHOOK_PATTERN, "Paste a Discord webhook URL (Server settings → Integrations → Webhooks)"),
  }),
  SLACK: z.object({
    slackIntegrationId: z.string().min(1).max(64),
    channelId: z.string().regex(/^[A-Z0-9]{5,20}$/),
    channelName: z.string().max(80),
  }),
  EMAIL: z.object({ to: emailAddressSchema }),
  WHATSAPP: z.object({ phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Use the international format, e.g. +919876543210") }),
} satisfies Record<ChannelKind, z.ZodType>;

export type ChannelConfig<K extends ChannelKind> = z.infer<(typeof channelConfigSchemas)[K]>;

/** The value whose fingerprint identifies the channel (for de-duplication and lookup). */
export function channelIdentity(kind: ChannelKind, config: unknown): string {
  switch (kind) {
    case "TELEGRAM":
      return `telegram:${channelConfigSchemas.TELEGRAM.parse(config).chatId}`;
    case "DISCORD_WEBHOOK":
      return `discord:${channelConfigSchemas.DISCORD_WEBHOOK.parse(config).webhookUrl}`;
    case "SLACK": {
      const slack = channelConfigSchemas.SLACK.parse(config);
      return `slack:${slack.slackIntegrationId}:${slack.channelId}`;
    }
    case "EMAIL":
      return `email:${channelConfigSchemas.EMAIL.parse(config).to}`;
    case "WHATSAPP":
      return `whatsapp:${channelConfigSchemas.WHATSAPP.parse(config).phone}`;
  }
}

export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  TELEGRAM: "Telegram",
  DISCORD_WEBHOOK: "Discord",
  SLACK: "Slack",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
};
