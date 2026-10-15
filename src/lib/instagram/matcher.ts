import type { InstagramTrigger, KeywordMatch } from "@/generated/prisma/enums";
import type { InboundEvent } from "@/lib/instagram/types";

export interface MatchableAutomation {
  id: string;
  trigger: InstagramTrigger;
  mediaIds: string[];
  keywords: string[];
  matchMode: KeywordMatch;
  createdAt: Date;
}

const TRIGGER_FOR_EVENT: Partial<Record<InboundEvent["kind"], InstagramTrigger>> = {
  COMMENT: "COMMENT",
  MESSAGE: "DM_KEYWORD",
  STORY_REPLY: "STORY_REPLY",
  STORY_MENTION: "STORY_MENTION",
};

/** Lower-case, strip accents and collapse whitespace so "LINK!" matches "link". */
export function normaliseText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): string[] {
  return normaliseText(value)
    .split(/[^\p{L}\p{N}#@_]+/u)
    .filter(Boolean);
}

export function keywordMatches(text: string | null, keywords: string[], mode: KeywordMatch): boolean {
  if (mode === "ANY") return true;
  if (!text) return false;
  const normalised = normaliseText(text);
  const tokens = words(text);
  return keywords.some((keyword) => {
    const needle = normaliseText(keyword);
    if (!needle) return false;
    if (mode === "EXACT") return normalised.replace(/[^\p{L}\p{N}#@_ ]+/gu, "").trim() === needle;
    // CONTAINS matches whole words or phrases, so "link" does not fire on "linked".
    if (needle.includes(" ")) return ` ${tokens.join(" ")} `.includes(` ${words(needle).join(" ")} `);
    return tokens.includes(needle);
  });
}

/**
 * Picks the automation that handles `event`. Media-specific automations win
 * over account-wide ones, keyword automations over catch-alls, then the oldest.
 */
export function matchAutomation<T extends MatchableAutomation>(
  event: InboundEvent,
  automations: readonly T[],
): T | null {
  const trigger = TRIGGER_FOR_EVENT[event.kind];
  if (!trigger) return null;

  const text = event.kind === "COMMENT" ? event.text : "text" in event ? event.text : null;
  const mediaId = event.kind === "COMMENT" ? event.mediaId : null;

  const candidates = automations.filter((automation) => {
    if (automation.trigger !== trigger) return false;
    if (trigger === "COMMENT" && automation.mediaIds.length > 0) {
      if (!mediaId || !automation.mediaIds.includes(mediaId)) return false;
    }
    // Story mentions carry no text; a mention is the trigger itself.
    if (trigger === "STORY_MENTION") return true;
    return keywordMatches(text, automation.keywords, automation.matchMode);
  });

  const score = (automation: T) =>
    (automation.mediaIds.length > 0 ? 2 : 0) + (automation.matchMode === "ANY" ? 0 : 1);

  candidates.sort((a, b) => score(b) - score(a) || a.createdAt.getTime() - b.createdAt.getTime());
  return candidates[0] ?? null;
}
