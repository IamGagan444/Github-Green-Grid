import { z } from "zod";

import { MAX_COMMITS_PER_DAY, MIN_COMMITS_PER_DAY } from "@/lib/schedule/next-run";
import { isValidTimezone, WEEKDAYS } from "@/lib/schedule/timezone";

export const weekdaySchema = z.enum(WEEKDAYS);

export const timezoneSchema = z
  .string()
  .min(1, "Select a timezone.")
  .refine(isValidTimezone, "That timezone is not recognised.");

/**
 * How many commits a schedule makes on each selected day. The clock times are
 * derived from this (one commit per hour) and are never supplied by the client.
 */
export const commitsPerDaySchema = z.coerce
  .number()
  .int("Choose a whole number of commits.")
  .min(MIN_COMMITS_PER_DAY, "At least one commit per day.")
  .max(MAX_COMMITS_PER_DAY, "At most " + MAX_COMMITS_PER_DAY + " commits per day.");

export const daysOfWeekSchema = z
  .array(weekdaySchema)
  .min(1, "Select at least one day.")
  .max(7)
  .refine(
    (days) => new Set(days).size === days.length,
    "Each day can only be selected once.",
  );

/** True when the string contains ASCII control characters (including newlines). */
export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Commit messages are user-configurable but constrained: a single line with no
 * control characters, so they cannot be used to forge trailers or headers.
 */
export const commitMessageSchema = z
  .string()
  .trim()
  .min(3, "Commit message is too short.")
  .max(72, "Keep the commit message under 72 characters.")
  .refine((value) => !hasControlCharacters(value), "Commit message must be a single line.");

/** Repository-relative path of the maintenance file. */
export const activityPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !value.startsWith("/"), "Path must be relative to the repository root.")
  .refine((value) => !value.includes(".."), "Path must not traverse parent directories.")
  .refine((value) => /^[A-Za-z0-9._\-/]+$/.test(value), "Path contains unsupported characters.")
  .refine((value) => value.endsWith(".json"), "The activity file must be a .json file.");

export const createScheduleSchema = z.object({
  repositoryId: z.string().min(1, "Select a repository."),
  enabled: z.boolean().optional().default(false),
  timezone: timezoneSchema,
  commitsPerDay: commitsPerDaySchema,
  daysOfWeek: daysOfWeekSchema,
  commitMessage: commitMessageSchema.optional(),
  activityPath: activityPathSchema.optional(),
});

export const updateScheduleSchema = z
  .object({
    repositoryId: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    timezone: timezoneSchema.optional(),
    commitsPerDay: commitsPerDaySchema.optional(),
    daysOfWeek: daysOfWeekSchema.optional(),
    commitMessage: commitMessageSchema.optional(),
    activityPath: activityPathSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export const selectRepositorySchema = z.object({
  githubRepositoryId: z.string().min(1),
});

export const manualRunSchema = z.object({
  scheduleId: z.string().min(1),
});

export const settingsSchema = z.object({
  defaultTimezone: timezoneSchema,
  defaultCommitMessage: commitMessageSchema,
});

export const activityQuerySchema = z.object({
  status: z.enum(["ALL", "COMPLETED", "FAILED", "SKIPPED"]).optional().default("ALL"),
  repositoryId: z.string().min(1).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
