import "server-only";

import { createChatCompletion } from "@/lib/ai/nemotron-client";
import { buildSummaryMessages } from "@/lib/ai/prompt";
import { parseAiSummary, type AiSummary } from "@/lib/ai/schema";
import type { AiPort } from "@/lib/automation/types";
import { createLogger } from "@/lib/logging/logger";
import { withRetry } from "@/lib/retry";
import type { AuthoredCommit } from "@/lib/github/types";
import type { MessageStyle } from "@/generated/prisma/enums";

const log = createLogger("ai-service");

export interface GenerateSummaryInput {
  commits: AuthoredCommit[];
  style: MessageStyle;
  quickNote: string | null;
  wantHeadline: boolean;
  dateLabel: string;
}

/**
 * Generates a validated standup summary with Nemotron.
 *
 * Provider failures and invalid output are both retried with backoff (a model
 * occasionally emits malformed JSON). After the final attempt the error
 * propagates — malformed content is never posted.
 */
export async function generateStandupSummary(input: GenerateSummaryInput): Promise<{ summary: AiSummary; model: string }> {
  const messages = buildSummaryMessages(input);

  return withRetry(
    async () => {
      const completion = await createChatCompletion(messages);
      try {
        return { summary: parseAiSummary(completion.content, input.commits.length), model: completion.model };
      } catch (error) {
        log.warn("AI output rejected by validation", {
          model: completion.model,
          reason: error instanceof Error ? error.message : "unknown",
        });
        throw error;
      }
    },
    { attempts: 3, baseDelayMs: 1_500, maxDelayMs: 10_000 },
  );
}

export function createAiPort(): AiPort {
  return {
    summarize: ({ commits, automation, dateLabel }) =>
      generateStandupSummary({
        commits,
        style: automation.messageStyle,
        quickNote: automation.quickNote,
        wantHeadline: automation.threadMode === "AI_PARENT",
        dateLabel,
      }),
  };
}
