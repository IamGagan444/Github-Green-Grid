import "server-only";

import { ConfigurationError, getAiConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";

const REQUEST_TIMEOUT_MS = 90_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
}

/**
 * NVIDIA's OpenAI-compatible chat completions endpoint. Called only from the
 * server; the API key is sent in the Authorization header and never logged.
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

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.2,
        top_p: 0.9,
        max_tokens: options.maxTokens ?? 2048,
        stream: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("AI_PROVIDER_FAILED", "NVIDIA API network error or timeout");
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "2");
    throw new AppError("AI_PROVIDER_FAILED", "NVIDIA API rate limited", {
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000,
    });
  }
  if (response.status === 401 || response.status === 403) {
    // A bad API key is an operator problem; retrying will not help.
    throw new AppError("AI_NOT_CONFIGURED", `NVIDIA API rejected credentials (${response.status})`);
  }
  if (!response.ok) {
    throw new AppError("AI_PROVIDER_FAILED", `NVIDIA API responded ${response.status}`);
  }

  let payload: {
    model?: string;
    choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
  };
  try {
    payload = await response.json();
  } catch {
    throw new AppError("AI_INVALID_OUTPUT", "NVIDIA API returned non-JSON");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new AppError("AI_INVALID_OUTPUT", "NVIDIA API returned an empty completion");
  }

  return { content, model: payload.model ?? config.model };
}
