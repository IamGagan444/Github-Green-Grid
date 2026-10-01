export const queryKeys = {
  githubRepositories: ["github", "repositories"] as const,
  githubBranches: (owner: string, name: string) => ["github", "branches", owner, name] as const,
  slackChannels: (integrationId: string, mode: string) => ["slack", "channels", integrationId, mode] as const,
  calendarDay: (day: string) => ["activity", "calendar-day", day] as const,
};
