import "server-only";

import { createOpenAiCompatibleCompletion, type ChatCompletionResult, type ChatMessage } from "@/lib/ai/openai-compatible";
import { ConfigurationError, getAiConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type { ChatCompletionResult, ChatMessage };

/**
 * The platform AI endpoint (NVIDIA by default, NVIDIA_* variables). Standup
 * summaries use it in every environment; the hub automations use it only
 * outside production, as a fallback when the user has no key of their own.
 */
export async function createChatCompletion(
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<ChatCompletionResult> {
  let config;
  try {
    config = getAiConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) throw new AppError("AI_NOT_CONFIGURED", error.message);
    throw error;
  }
  return createOpenAiCompatibleCompletion(config, messages, options);
}
