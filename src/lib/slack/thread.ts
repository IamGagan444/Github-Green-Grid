import {
  HEADER_EVENT_TYPE,
  UPDATE_EVENT_TYPE,
  type SlackHistoryMessage,
  type SlackMessageMetadata,
} from "@/lib/slack/types";

/**
 * Pure thread-detection logic. Given a day's channel history, find the parent
 * message to reply under and detect whether this execution already posted.
 */

/** Emoji can come back from Slack as unicode or as `:shortcode:`; compare without them. */
export function normaliseHeaderText(text: string): string {
  return text
    .replace(/:[a-z0-9_+-]+:/gi, "")
    .replace(/\p{Extended_Pictographic}|️/gu, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isTopLevel(message: SlackHistoryMessage): boolean {
  return !message.thread_ts || message.thread_ts === message.ts;
}

/** Messages with these subtypes are system events, never a header. */
const IGNORED_SUBTYPES = new Set([
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "message_deleted",
  "tombstone",
]);

export function headerMetadata(dateKey: string, anchorKey: string): SlackMessageMetadata {
  return { event_type: HEADER_EVENT_TYPE, event_payload: { date_key: dateKey, anchor_key: anchorKey } };
}

export function updateMetadata(executionKey: string, executionId: string): SlackMessageMetadata {
  return {
    event_type: UPDATE_EVENT_TYPE,
    event_payload: { execution_key: executionKey, execution_id: executionId },
  };
}

/**
 * Finds today's parent message. Preference order:
 *  1. a message carrying our header metadata for this date and anchor,
 *  2. a top-level message whose text matches the header text exactly
 *     (ignoring emoji form and whitespace) — e.g. posted by a teammate's
 *     automation or by hand.
 * The earliest match wins so every automation converges on the same thread.
 */
export function findDailyParent(
  messages: readonly SlackHistoryMessage[],
  expected: { dateKey: string; anchorKey: string; headerText: string },
): SlackHistoryMessage | null {
  const candidates = messages
    .filter((message) => isTopLevel(message) && !IGNORED_SUBTYPES.has(message.subtype ?? ""))
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  const byMetadata = candidates.find(
    (message) =>
      message.metadata?.event_type === HEADER_EVENT_TYPE &&
      message.metadata.event_payload?.date_key === expected.dateKey &&
      message.metadata.event_payload?.anchor_key === expected.anchorKey,
  );
  if (byMetadata) return byMetadata;

  const wanted = normaliseHeaderText(expected.headerText);
  if (!wanted) return null;
  return candidates.find((message) => normaliseHeaderText(message.text ?? "") === wanted) ?? null;
}

/**
 * An update this execution already posted (crash between post and DB write).
 * Matches our message metadata first; falls back to the exact message text,
 * which a resumed run reproduces byte-for-byte from the stored AI output — so
 * detection still works if a workspace or token type drops metadata.
 */
export function findExistingUpdate(
  messages: readonly SlackHistoryMessage[],
  executionKey: string,
  expectedText?: string,
): SlackHistoryMessage | null {
  const byMetadata = messages.find(
    (message) =>
      message.metadata?.event_type === UPDATE_EVENT_TYPE &&
      message.metadata.event_payload?.execution_key === executionKey,
  );
  if (byMetadata) return byMetadata;
  if (!expectedText) return null;
  return messages.find((message) => message.text === expectedText) ?? null;
}
