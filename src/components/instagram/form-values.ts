/**
 * Form shape and defaults for the Instagram automation editor. Kept out of the
 * "use client" form module so Server Components can read the values: anything
 * a server file imports from a client module is only a reference, not data.
 */

export type TriggerValue = "COMMENT" | "DM_KEYWORD" | "STORY_REPLY" | "STORY_MENTION";
export type MatchValue = "CONTAINS" | "EXACT" | "ANY";

export interface InstagramAutomationFormValues {
  integrationId: string;
  name: string;
  trigger: TriggerValue;
  mediaIds: string[];
  matchMode: MatchValue;
  keywords: string[];
  publicReplyEnabled: boolean;
  publicReplies: string[];
  dmMessage: string;
  linkUrl: string | null;
  linkButtonLabel: string;
  followGateEnabled: boolean;
  followGateMessage: string;
  followButtonLabel: string;
}

export const DEFAULT_VALUES: Omit<InstagramAutomationFormValues, "integrationId"> = {
  name: "",
  trigger: "COMMENT",
  mediaIds: [],
  matchMode: "CONTAINS",
  keywords: [],
  publicReplyEnabled: true,
  publicReplies: ["Sent! Check your DMs 📩", "Just sent it to your inbox 🙌", "Check your DMs 💌"],
  dmMessage: "Hey! Here's the link you asked for 👇",
  linkUrl: null,
  linkButtonLabel: "Open link",
  followGateEnabled: false,
  followGateMessage: "Follow us first, then tap the button below to get the link 👇",
  followButtonLabel: "I'm following ✅",
};
