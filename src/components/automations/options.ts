/** Labels shared by the automation wizard, cards and settings. */

export const MESSAGE_STYLE_OPTIONS = [
  { value: "CONCISE", label: "Concise", description: "2–5 short bullets. The default for most teams." },
  { value: "DETAILED", label: "Detailed", description: "More context per bullet, including the why when commits state it." },
  { value: "TECHNICAL", label: "Technical", description: "Keeps component, file and API names for an engineering audience." },
  { value: "NON_TECHNICAL", label: "Non-technical", description: "Plain-language outcomes for stakeholders." },
] as const;

export const THREAD_MODE_OPTIONS = [
  {
    value: "DATE_HEADER",
    label: "Reply under a date header",
    description: "One “📅 Wednesday, September 30, 2026” parent per day; your update is a thread reply. Teammates' automations share the same thread.",
  },
  {
    value: "AI_PARENT",
    label: "AI-generated parent",
    description: "The parent message is a short AI headline for your day; the bullets are a thread reply.",
  },
  {
    value: "NO_THREAD",
    label: "Post to the channel",
    description: "A single top-level message per day, no thread.",
  },
] as const;

export const COMMIT_WINDOW_OPTIONS = [
  { value: "SAME_DAY", label: "Same day", description: "Summarise commits from the day the update posts (evening standups)." },
  { value: "PREVIOUS_DAY", label: "Previous day", description: "Summarise yesterday's commits (morning standups)." },
] as const;

export const POSTING_MODE_OPTIONS = [
  { value: "BOT", label: "Post as the GreenGrid app", description: "Uses the workspace bot. Public channels are joined automatically; invite the app to private channels." },
  { value: "USER", label: "Post as me", description: "Posts under your own Slack identity. Requires approving user permissions when connecting Slack." },
] as const;

export function labelFor<T extends { value: string; label: string }>(options: readonly T[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
