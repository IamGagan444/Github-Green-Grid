import { z } from "zod";

import type { InboundEvent } from "@/lib/instagram/types";

/**
 * Meta webhook payloads for the Instagram API with Instagram Login.
 * Unknown fields pass through; unknown change/messaging shapes are dropped
 * rather than failing the whole delivery.
 */

const commentValue = z.object({
  id: z.string().max(64),
  text: z.string().max(2_200).default(""),
  parent_id: z.string().max(64).optional(),
  from: z.object({ id: z.string().max(64), username: z.string().max(64).optional() }),
  media: z
    .object({ id: z.string().max(64), media_product_type: z.string().max(32).optional() })
    .optional(),
});

const messagingItem = z.object({
  sender: z.object({ id: z.string().max(64) }),
  recipient: z.object({ id: z.string().max(64) }),
  timestamp: z.number(),
  message: z
    .object({
      mid: z.string().max(256),
      text: z.string().max(4_000).optional(),
      is_echo: z.boolean().optional(),
      is_deleted: z.boolean().optional(),
      quick_reply: z.object({ payload: z.string().max(1_000) }).optional(),
      reply_to: z
        .object({ story: z.object({ id: z.string().max(64).optional(), url: z.string().optional() }).optional() })
        .passthrough()
        .optional(),
      attachments: z.array(z.object({ type: z.string().max(40) }).passthrough()).optional(),
    })
    .passthrough()
    .optional(),
  postback: z
    .object({ mid: z.string().max(256), title: z.string().max(200).optional(), payload: z.string().max(1_000) })
    .optional(),
});

const entrySchema = z.object({
  id: z.string().max(64),
  time: z.number(),
  changes: z.array(z.object({ field: z.string().max(40), value: z.unknown() })).optional(),
  messaging: z.array(z.unknown()).optional(),
});

export const webhookEnvelopeSchema = z.object({
  object: z.string().max(40),
  entry: z.array(entrySchema).max(100),
});

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

function fromEpoch(value: number): Date {
  // `entry.time` / `timestamp` are seconds in some deliveries, ms in others.
  return new Date(value < 1e12 ? value * 1000 : value);
}

/** Flattens a verified envelope into the events GreenGrid acts on. */
export function normaliseWebhook(envelope: WebhookEnvelope): InboundEvent[] {
  if (envelope.object !== "instagram") return [];
  const events: InboundEvent[] = [];

  for (const entry of envelope.entry) {
    const igUserId = entry.id;

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const parsed = commentValue.safeParse(change.value);
      if (!parsed.success) continue;
      const comment = parsed.data;
      // Our own comments (including the public replies we post) are ignored.
      if (comment.from.id === igUserId) continue;
      events.push({
        kind: "COMMENT",
        igUserId,
        commentId: comment.id,
        senderIgsid: comment.from.id,
        senderUsername: comment.from.username ?? null,
        mediaId: comment.media?.id ?? null,
        mediaProductType: comment.media?.media_product_type ?? null,
        text: comment.text,
        occurredAt: fromEpoch(entry.time),
      });
    }

    for (const raw of entry.messaging ?? []) {
      const parsed = messagingItem.safeParse(raw);
      if (!parsed.success) continue;
      const item = parsed.data;
      // Echoes of messages the account sent, and anything not addressed to it.
      if (item.sender.id === igUserId || item.recipient.id !== igUserId) continue;
      const occurredAt = fromEpoch(item.timestamp);

      if (item.postback) {
        events.push({
          kind: "POSTBACK",
          igUserId,
          mid: item.postback.mid,
          senderIgsid: item.sender.id,
          payload: item.postback.payload,
          occurredAt,
        });
        continue;
      }

      const message = item.message;
      if (!message || message.is_echo || message.is_deleted) continue;

      // Quick replies behave like button taps.
      if (message.quick_reply) {
        events.push({
          kind: "POSTBACK",
          igUserId,
          mid: message.mid,
          senderIgsid: item.sender.id,
          payload: message.quick_reply.payload,
          occurredAt,
        });
        continue;
      }

      const isMention = message.attachments?.some((attachment) => attachment.type === "story_mention") ?? false;
      const kind = isMention ? "STORY_MENTION" : message.reply_to?.story ? "STORY_REPLY" : "MESSAGE";
      events.push({
        kind,
        igUserId,
        mid: message.mid,
        senderIgsid: item.sender.id,
        text: message.text ?? null,
        occurredAt,
      });
    }
  }

  return events;
}
