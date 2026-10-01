import { z } from "zod";

import { daysOfWeekSchema, hasControlCharacters, timezoneSchema } from "@/lib/validation/schemas";

export const MAX_SOURCES_PER_AUTOMATION = 5;

const githubNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/, "Invalid GitHub name.");

/** Git ref names: conservative subset of `git check-ref-format`. */
export const branchNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !hasControlCharacters(value), "Invalid branch name.")
  .refine((value) => !/[\s~^:?*[\\]|\.\.|@\{|^\/|\/$|\.lock$|^-/.test(value), "Invalid branch name.");

export const githubSourceSchema = z
  .object({
    repositoryId: z.string().regex(/^\d{1,20}$/, "Invalid repository id."),
    owner: githubNameSchema,
    name: githubNameSchema,
    /** null = all branches. */
    branch: branchNameSchema.nullable(),
  })
  .strict()
  .transform((source) => ({ ...source, fullName: `${source.owner}/${source.name}` }));

export type GitHubSource = z.output<typeof githubSourceSchema>;

export const githubSourcesSchema = z
  .array(githubSourceSchema)
  .min(1, "Select at least one repository.")
  .max(MAX_SOURCES_PER_AUTOMATION, `Select at most ${MAX_SOURCES_PER_AUTOMATION} repositories.`)
  .refine(
    (sources) => new Set(sources.map((source) => source.repositoryId)).size === sources.length,
    "Each repository can only be selected once.",
  );

export const scheduleTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM time.");

export const MAX_SCHEDULE_TIMES = 24;

/** 1–24 distinct times per day, stored sorted. */
export const scheduleTimesSchema = z
  .array(scheduleTimeSchema)
  .min(1, "Add at least one time.")
  .max(MAX_SCHEDULE_TIMES, `At most ${MAX_SCHEDULE_TIMES} times per day.`)
  .refine((times) => new Set(times).size === times.length, "Each time can only be added once.")
  .transform((times) => [...times].sort());

/** "Previous day" posts a recap of yesterday, which only makes sense once a day. */
export function scheduleTimesProblem(
  commitWindow: "SAME_DAY" | "PREVIOUS_DAY",
  scheduleTimes: readonly string[],
): string | null {
  return commitWindow === "PREVIOUS_DAY" && scheduleTimes.length > 1
    ? "“Previous day” posts yesterday's recap, so it runs at one time per day."
    : null;
}

function refineScheduleTimes(
  value: { commitWindow?: "SAME_DAY" | "PREVIOUS_DAY"; scheduleTimes?: string[] },
  context: z.RefinementCtx,
) {
  const problem = scheduleTimesProblem(value.commitWindow ?? "SAME_DAY", value.scheduleTimes ?? []);
  if (problem) context.addIssue({ code: "custom", path: ["scheduleTimes"], message: problem });
}

export const automationNameSchema = z
  .string()
  .trim()
  .min(2, "Name is too short.")
  .max(80, "Keep the name under 80 characters.")
  .refine((value) => !hasControlCharacters(value), "Name must be a single line.");

export const quickNoteSchema = z
  .string()
  .trim()
  .max(500, "Keep the note under 500 characters.")
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

export const headerFormatSchema = z
  .string()
  .trim()
  .min(6)
  .max(80)
  .refine((value) => value.includes("{date}"), "Header must include {date}.")
  .refine((value) => !hasControlCharacters(value), "Header must be a single line.")
  .refine((value) => !/[<>&]/.test(value), "Header cannot contain <, > or &.");

const slackIdSchema = z.string().regex(/^[A-Z0-9]{6,20}$/, "Invalid Slack id.");

export const messageStyleSchema = z.enum(["CONCISE", "DETAILED", "TECHNICAL", "NON_TECHNICAL"]);
export const threadModeSchema = z.enum(["DATE_HEADER", "AI_PARENT", "NO_THREAD"]);
export const postingModeSchema = z.enum(["BOT", "USER"]);
export const commitWindowSchema = z.enum(["SAME_DAY", "PREVIOUS_DAY"]);

export const automationConfigSchema = z
  .object({
    name: automationNameSchema,
    githubSources: githubSourcesSchema,
    commitWindow: commitWindowSchema.default("SAME_DAY"),
    messageStyle: messageStyleSchema.default("CONCISE"),
    quickNote: quickNoteSchema.default(null),
    includeFileStats: z.boolean().default(false),
    slackIntegrationId: z.string().min(1, "Select a Slack workspace.").max(40),
    slackChannelId: slackIdSchema,
    slackChannelName: z.string().trim().min(1).max(80),
    postingMode: postingModeSchema.default("BOT"),
    threadMode: threadModeSchema.default("DATE_HEADER"),
    headerFormat: headerFormatSchema.default("📅 {date}"),
    daysOfWeek: daysOfWeekSchema,
    scheduleTimes: scheduleTimesSchema,
    timezone: timezoneSchema,
  })
  .strict();

export type AutomationConfigInput = z.input<typeof automationConfigSchema>;
export type AutomationConfig = z.output<typeof automationConfigSchema>;

/** The wizard's schema: the config plus cross-field schedule rules. */
export const automationFormSchema = automationConfigSchema.superRefine(refineScheduleTimes);

export const createAutomationSchema = automationConfigSchema
  .extend({ activate: z.boolean().default(true) })
  .superRefine(refineScheduleTimes);

export const updateAutomationSchema = automationConfigSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Nothing to update.",
);

export const automationStatusActionSchema = z
  .object({ action: z.enum(["pause", "resume"]) })
  .strict();

export const previewAutomationSchema = automationConfigSchema
  .pick({
    githubSources: true,
    commitWindow: true,
    messageStyle: true,
    quickNote: true,
    includeFileStats: true,
    slackIntegrationId: true,
    slackChannelId: true,
    postingMode: true,
    threadMode: true,
    headerFormat: true,
    timezone: true,
  })
  .strict();

export type PreviewAutomationInput = z.output<typeof previewAutomationSchema>;

export const executionQuerySchema = z.object({
  status: z.enum(["ALL", "RUNNING", "SUCCESS", "FAILED", "SKIPPED"]).optional().default("ALL"),
  automationId: z.string().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type ExecutionQuery = z.infer<typeof executionQuerySchema>;

export const idParamSchema = z.string().min(1).max(40).regex(/^[a-z0-9]+$/i, "Invalid id.");

/** Validates JSON read back from the database before trusting it. */
export function parseStoredSources(value: unknown): GitHubSource[] {
  if (!Array.isArray(value)) return [];
  // Stored rows carry the derived fullName, which the strict input schema rejects.
  const inputs = value.map((entry) =>
    entry && typeof entry === "object"
      ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "fullName"))
      : entry,
  );
  const parsed = z.array(githubSourceSchema).safeParse(inputs);
  return parsed.success ? parsed.data : [];
}
