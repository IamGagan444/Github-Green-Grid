import { z } from "zod";

import { AppError } from "@/lib/errors";
import { normaliseBullet } from "@/lib/slack/message";

export const MAX_SUMMARY_BULLETS = 8;
const MIN_BULLET_LENGTH = 8;
const MAX_BULLET_LENGTH = 280;
const MAX_HEADLINE_LENGTH = 90;

/** Words that, on their own, describe no work. A bullet made only of these is rejected. */
const MEANINGLESS = /^(wip|update[sd]?|fix(es|ed)?|changes?|misc|stuff|minor|tmp|test(ing)?|commit|merge)\.?$/i;

/** Slack broadcast/mention syntax the model must never emit, even pre-escaping. */
const SLACK_CONTROL = /<[!@#]|<https?:|\|>/i;

const bulletSchema = z
  .string()
  .transform(normaliseBullet)
  .pipe(
    z
      .string()
      .min(MIN_BULLET_LENGTH, "bullet too short")
      .max(MAX_BULLET_LENGTH, "bullet too long")
      .refine((value) => !MEANINGLESS.test(value), "bullet is not meaningful")
      .refine((value) => !SLACK_CONTROL.test(value), "bullet contains Slack control syntax"),
  );

export const aiSummarySchema = z
  .object({
    summary: z.array(bulletSchema).min(1).max(MAX_SUMMARY_BULLETS),
    headline: z
      .string()
      .transform(normaliseBullet)
      .pipe(z.string().min(3).max(MAX_HEADLINE_LENGTH))
      .optional(),
  })
  .strict();

export type AiSummary = z.infer<typeof aiSummarySchema>;

/**
 * Extracts the JSON object from a model response. Reasoning models may wrap
 * output in <think> blocks or ``` fences; anything else is rejected rather
 * than guessed at.
 */
export function extractJsonObject(content: string): unknown {
  const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? withoutThinking).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AppError("AI_INVALID_OUTPUT", "AI response contained no JSON object");
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AppError("AI_INVALID_OUTPUT", "AI response JSON did not parse");
  }
}

/**
 * Parses and validates model output. Also enforces a grounding bound: a
 * summary cannot contain more distinct items than there were commits, because
 * every bullet must be supported by at least one commit.
 */
export function parseAiSummary(content: string, commitCount: number): AiSummary {
  const parsed = aiSummarySchema.safeParse(extractJsonObject(content));
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new AppError("AI_INVALID_OUTPUT", `AI output failed validation (${reasons.join("; ").slice(0, 300)})`);
  }

  const unique = [...new Set(parsed.data.summary.map((bullet) => bullet.toLowerCase()))];
  if (unique.length !== parsed.data.summary.length) {
    throw new AppError("AI_INVALID_OUTPUT", "AI output contained duplicate bullets");
  }
  if (parsed.data.summary.length > Math.max(1, commitCount)) {
    throw new AppError("AI_INVALID_OUTPUT", "AI output has more bullets than commits");
  }

  return parsed.data;
}
