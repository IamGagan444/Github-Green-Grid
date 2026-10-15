import type { OutgoingMessage, PostbackButton, UrlButton } from "@/lib/instagram/types";

/** Instagram limits: button template text ≤ 640 chars, button title ≤ 20. */
export const MAX_TEMPLATE_TEXT = 640;
export const MAX_BUTTON_TITLE = 20;

const FOLLOW_GATE_PREFIX = "GG_FOLLOW:";

export interface DmContent {
  dmMessage: string;
  linkUrl: string | null;
  linkButtonLabel: string;
  followGateEnabled: boolean;
  followGateMessage: string;
  followButtonLabel: string;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function template(text: string, buttons: Array<UrlButton | PostbackButton>): OutgoingMessage {
  return {
    attachment: {
      type: "template",
      payload: { template_type: "button", text: clip(text, MAX_TEMPLATE_TEXT), buttons },
    },
  };
}

/** Postback payload carried by the follow-gate button: the originating event id. */
export function followGatePayload(eventId: string): string {
  return `${FOLLOW_GATE_PREFIX}${eventId}`;
}

export function parseFollowGatePayload(payload: string): string | null {
  if (!payload.startsWith(FOLLOW_GATE_PREFIX)) return null;
  const id = payload.slice(FOLLOW_GATE_PREFIX.length);
  return /^[a-z0-9]{10,40}$/i.test(id) ? id : null;
}

/** The DM that delivers the link (or plain text when no link is set). */
export function buildLinkMessage(content: DmContent, trackedUrl: string | null): OutgoingMessage {
  if (!content.linkUrl || !trackedUrl) return { text: content.dmMessage };
  return template(content.dmMessage, [
    { type: "web_url", url: trackedUrl, title: clip(content.linkButtonLabel, MAX_BUTTON_TITLE) },
  ]);
}

/** The follow-gate DM: asks the person to follow, with a "check" button. */
export function buildFollowGateMessage(content: DmContent, eventId: string): OutgoingMessage {
  return template(content.followGateMessage, [
    {
      type: "postback",
      title: clip(content.followButtonLabel, MAX_BUTTON_TITLE),
      payload: followGatePayload(eventId),
    },
  ]);
}

/** First DM for an event: the gate when enabled, otherwise the link itself. */
export function buildFirstMessage(content: DmContent, eventId: string, trackedUrl: string | null): OutgoingMessage {
  return content.followGateEnabled ? buildFollowGateMessage(content, eventId) : buildLinkMessage(content, trackedUrl);
}

export function pickPublicReply(variants: readonly string[], random: () => number = Math.random): string | null {
  const usable = variants.map((variant) => variant.trim()).filter(Boolean);
  if (usable.length === 0) return null;
  return usable[Math.floor(random() * usable.length)] ?? usable[0] ?? null;
}
