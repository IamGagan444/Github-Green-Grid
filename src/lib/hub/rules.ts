import { z } from "zod";

import type { NotificationSource } from "@/generated/prisma/enums";
import { hubMessageSchema, type HubMessage } from "@/lib/hub/message";

/**
 * Notification events and the rules that route them. Producers store a
 * ready-to-render message plus a few flat attributes to filter on; rules are
 * pure predicates over those attributes, validated per source.
 */

export const GITHUB_EVENT_TYPES = [
  "pull_request.opened",
  "pull_request.review_requested",
  "check_suite.failed",
  "release.published",
  "issues.opened",
] as const;
export type GitHubEventType = (typeof GITHUB_EVENT_TYPES)[number];

export const UPTIME_EVENT_TYPES = ["uptime.down", "uptime.up", "uptime.tls_expiring"] as const;
export type UptimeEventType = (typeof UPTIME_EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<string, string> = {
  "pull_request.opened": "Pull request opened",
  "pull_request.review_requested": "Review requested",
  "check_suite.failed": "Checks failed",
  "release.published": "Release published",
  "issues.opened": "Issue opened",
  "uptime.down": "Site down",
  "uptime.up": "Site back up",
  "uptime.tls_expiring": "TLS certificate expiring",
};

const repositoryName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/, "Use owner/name");

const idList = z.array(z.string().trim().min(1).max(64)).max(100).default([]);

export const ruleFilterSchemas = {
  GITHUB: z.object({
    events: z.array(z.enum(GITHUB_EVENT_TYPES)).min(1, "Pick at least one event").max(GITHUB_EVENT_TYPES.length),
    /** Empty means every repository the GitHub App can see. */
    repositories: z.array(repositoryName).max(100).default([]),
  }),
  UPTIME: z.object({
    events: z.array(z.enum(UPTIME_EVENT_TYPES)).min(1, "Pick at least one event").max(UPTIME_EVENT_TYPES.length),
    /** Empty means every monitor. */
    monitorIds: idList,
  }),
  FORM: z.object({ formIds: idList }),
  PAYMENT: z.object({}),
  REMINDER: z.object({}),
  DIGEST: z.object({}),
  CROSSPOST: z.object({ sourceIds: idList }),
} satisfies Record<NotificationSource, z.ZodType>;

export type RuleFilter<S extends NotificationSource> = z.infer<(typeof ruleFilterSchemas)[S]>;

export function parseRuleFilter(source: NotificationSource, filter: unknown) {
  return ruleFilterSchemas[source].parse(filter ?? {});
}

/** Flat attributes producers attach for filtering. */
export const eventAttrsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
export type EventAttrs = z.infer<typeof eventAttrsSchema>;

export const eventDataSchema = z.object({
  attrs: eventAttrsSchema.default({}),
  message: hubMessageSchema,
});
export type EventData = z.infer<typeof eventDataSchema>;

export interface MatchableEvent {
  source: NotificationSource;
  type: string;
  attrs: EventAttrs;
}

function inList(list: readonly string[], value: unknown): boolean {
  return list.length === 0 || (typeof value === "string" && list.includes(value.toLowerCase()));
}

/** True when the rule wants this event. A filter that no longer validates matches nothing. */
export function matchRule(rule: { source: NotificationSource; filter: unknown }, event: MatchableEvent): boolean {
  if (rule.source !== event.source) return false;
  const parsed = ruleFilterSchemas[rule.source].safeParse(rule.filter ?? {});
  if (!parsed.success) return false;

  switch (rule.source) {
    case "GITHUB": {
      const filter = parsed.data as RuleFilter<"GITHUB">;
      return (filter.events as readonly string[]).includes(event.type) && inList(filter.repositories, event.attrs.repository);
    }
    case "UPTIME": {
      const filter = parsed.data as RuleFilter<"UPTIME">;
      return (
        (filter.events as readonly string[]).includes(event.type) &&
        (filter.monitorIds.length === 0 || filter.monitorIds.includes(String(event.attrs.monitorId)))
      );
    }
    case "FORM": {
      const filter = parsed.data as RuleFilter<"FORM">;
      return filter.formIds.length === 0 || filter.formIds.includes(String(event.attrs.formId));
    }
    case "CROSSPOST": {
      const filter = parsed.data as RuleFilter<"CROSSPOST">;
      return filter.sourceIds.length === 0 || filter.sourceIds.includes(String(event.attrs.sourceId));
    }
    default:
      return true;
  }
}

export function describeRuleFilter(source: NotificationSource, filter: unknown): string {
  const parsed = ruleFilterSchemas[source].safeParse(filter ?? {});
  if (!parsed.success) return "Invalid filter";
  const data = parsed.data as Record<string, unknown>;
  const events = Array.isArray(data.events) ? (data.events as string[]).map((type) => EVENT_TYPE_LABELS[type] ?? type) : [];
  const repositories = Array.isArray(data.repositories) ? (data.repositories as string[]) : [];
  const parts = [events.join(", ")];
  if (source === "GITHUB") parts.push(repositories.length > 0 ? repositories.join(", ") : "all repositories");
  if (source === "UPTIME") parts.push((data.monitorIds as string[]).length > 0 ? "selected monitors" : "all monitors");
  return parts.filter(Boolean).join(" · ") || "All events";
}

export type { HubMessage };
