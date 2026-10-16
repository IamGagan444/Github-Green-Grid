import type { AiEndpoint } from "@/lib/ai/openai-compatible";
import { AppError } from "@/lib/errors";

/**
 * Bring-your-own-key AI for the hub automations. Every user pays for (or uses
 * the free tier of) their own provider; GreenGrid never spends money on AI.
 */

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
}

export interface CompletionResult {
  content: string;
  model: string;
}

export interface AiPort {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export type AiSource =
  | { kind: "user"; endpoint: AiEndpoint }
  | { kind: "platform"; endpoint: AiEndpoint }
  | { kind: "none" };

/**
 * The user's own key wins. The platform key is a development convenience only:
 * in production a user without a key gets no AI, never the operator's key.
 */
export function resolveAiSource(input: {
  userEndpoint: AiEndpoint | null;
  platformEndpoint: AiEndpoint | null;
  production: boolean;
}): AiSource {
  if (input.userEndpoint) return { kind: "user", endpoint: input.userEndpoint };
  if (!input.production && input.platformEndpoint) return { kind: "platform", endpoint: input.platformEndpoint };
  return { kind: "none" };
}

export const NO_AI_KEY_MESSAGE = "Add your own AI key in Settings → Connections to get AI summaries.";

export function noAiKeyError(): AppError {
  return new AppError("AI_NOT_CONFIGURED", "user has no AI credential", { userMessage: NO_AI_KEY_MESSAGE });
}

/** True when an AI step should be skipped (not failed) because the user has no key. */
export function isMissingAiKey(error: unknown): boolean {
  return error instanceof AppError && error.code === "AI_NOT_CONFIGURED";
}

/** Runs `request`, or returns null when the user has no AI configured. Other errors propagate. */
export async function completeOrSkip(port: AiPort, request: CompletionRequest): Promise<CompletionResult | null> {
  try {
    return await port.complete(request);
  } catch (error) {
    if (isMissingAiKey(error)) return null;
    throw error;
  }
}

/** Known OpenAI-compatible providers with free tiers, offered as presets in Settings. */
export const AI_PROVIDER_PRESETS = [
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    keyUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyUrl: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    keyUrl: "https://openrouter.ai/keys",
  },
] as const;
