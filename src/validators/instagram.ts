import { z } from "zod";

import { MAX_BUTTON_TITLE, MAX_TEMPLATE_TEXT } from "@/lib/instagram/message";
import { hasControlCharacters } from "@/lib/validation/schemas";

export const MAX_INSTAGRAM_AUTOMATIONS_PER_ACCOUNT = 50;
export const MAX_KEYWORDS = 20;
export const MAX_PUBLIC_REPLIES = 10;
export const MAX_MEDIA_PER_AUTOMATION = 50;

export const INSTAGRAM_TRIGGERS = ["COMMENT", "DM_KEYWORD", "STORY_REPLY", "STORY_MENTION"] as const;
export const KEYWORD_MATCH_MODES = ["CONTAINS", "EXACT", "ANY"] as const;

/** Allows newlines (DMs are multi-line) but no other control characters. */
const messageText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Required.")
    .max(max, `At most ${max} characters.`)
    .refine((value) => !hasControlCharacters(value.replace(/\r?\n/g, "")), "Contains invalid characters.");

const buttonLabel = z
  .string()
  .trim()
  .min(1, "Required.")
  .max(MAX_BUTTON_TITLE, `At most ${MAX_BUTTON_TITLE} characters.`)
  .refine((value) => !hasControlCharacters(value), "Contains invalid characters.");

export const linkUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .url("Enter a full URL, e.g. https://example.com.")
  .refine((value) => /^https:\/\//i.test(value), "Links must use https://.");

const keywordSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((value) => !hasControlCharacters(value), "Invalid keyword.")
  .transform((value) => value.toLowerCase());

export const instagramAutomationSchema = z
  .object({
    integrationId: z.string().min(1).max(40),
    name: z.string().trim().min(2, "Name is too short.").max(80, "Name is too long."),
    trigger: z.enum(INSTAGRAM_TRIGGERS),
    mediaIds: z.array(z.string().regex(/^\d{1,30}$/, "Invalid media id.")).max(MAX_MEDIA_PER_AUTOMATION).default([]),
    matchMode: z.enum(KEYWORD_MATCH_MODES).default("CONTAINS"),
    keywords: z
      .array(keywordSchema)
      .max(MAX_KEYWORDS, `At most ${MAX_KEYWORDS} keywords.`)
      .default([])
      .transform((keywords) => [...new Set(keywords)]),
    publicReplyEnabled: z.boolean().default(false),
    publicReplies: z.array(messageText(300)).max(MAX_PUBLIC_REPLIES).default([]),
    dmMessage: messageText(MAX_TEMPLATE_TEXT),
    linkUrl: linkUrlSchema.nullable().default(null),
    linkButtonLabel: buttonLabel.default("Open link"),
    followGateEnabled: z.boolean().default(false),
    followGateMessage: messageText(MAX_TEMPLATE_TEXT).default(
      "Follow us first, then tap the button below to get the link 👇",
    ),
    followButtonLabel: buttonLabel.default("I'm following ✅"),
  })
  .strict()
  .superRefine((value, context) => {
    const usesKeywords = value.trigger !== "STORY_MENTION" && value.matchMode !== "ANY";
    if (usesKeywords && value.keywords.length === 0) {
      context.addIssue({ code: "custom", path: ["keywords"], message: "Add at least one keyword, or match any text." });
    }
    if (value.trigger !== "COMMENT" && value.mediaIds.length > 0) {
      context.addIssue({ code: "custom", path: ["mediaIds"], message: "Posts can only be chosen for comment triggers." });
    }
    if (value.publicReplyEnabled && value.trigger !== "COMMENT") {
      context.addIssue({ code: "custom", path: ["publicReplyEnabled"], message: "Public replies only apply to comments." });
    }
    if (value.publicReplyEnabled && value.publicReplies.length === 0) {
      context.addIssue({ code: "custom", path: ["publicReplies"], message: "Add at least one public reply." });
    }
    if (value.followGateEnabled && !value.linkUrl) {
      context.addIssue({ code: "custom", path: ["linkUrl"], message: "The follow-gate needs a link to unlock." });
    }
  });

export type InstagramAutomationInput = z.output<typeof instagramAutomationSchema>;
