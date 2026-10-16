import "server-only";

import { AppError } from "@/lib/errors";

/**
 * Chat completions against any OpenAI-compatible endpoint (NVIDIA, Gemini's
 * OpenAI layer, Groq, OpenRouter, …). The key is sent only in the
 * Authorization header and is never logged or included in errors.
 */

const REQUEST_TIMEOUT_MS = 90_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
}

export interface AiEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object (`response_format`). Output is still validated by the caller. */
  json?: boolean;
  timeoutMs?: number;
  /**
   * Report 400/404/422 as a configuration problem (wrong model or URL) instead
   * of a transient failure. Used for user-supplied endpoints.
   */
  rejectBadRequests?: boolean;
  /** Override for user-supplied endpoints (SSRF-checked fetch). */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export async function createOpenAiCompatibleCompletion(
  endpoint: AiEndpoint,
  messages: ChatMessage[],
  options: CompletionOptions = {},
): Promise<ChatCompletionResult> {
  const fetchImpl = options.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init));

  let response: Response;
  try {
    response = await fetchImpl(`${endpoint.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages,
        temperature: options.temperature ?? 0.2,
        top_p: 0.9,
        max_tokens: options.maxTokens ?? 2048,
        stream: false,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("AI_PROVIDER_FAILED", "AI provider network error or timeout");
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "2");
    throw new AppError("AI_PROVIDER_FAILED", "AI provider rate limited", {
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000,
    });
  }
  if (response.status === 401 || response.status === 403) {
    // A bad API key is a configuration problem; retrying will not help.
    throw new AppError("AI_NOT_CONFIGURED", `AI provider rejected credentials (${response.status})`);
  }
  if (options.rejectBadRequests && (response.status === 400 || response.status === 404 || response.status === 422)) {
    throw new AppError("AI_NOT_CONFIGURED", `AI provider rejected the request (${response.status}); check the model name`, {
      userMessage: "The AI provider rejected the request. Check the base URL and model name in Settings → Connections.",
    });
  }
  if (!response.ok) {
    throw new AppError("AI_PROVIDER_FAILED", `AI provider responded ${response.status}`);
  }

  let payload: {
    model?: string;
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  try {
    payload = await response.json();
  } catch {
    throw new AppError("AI_INVALID_OUTPUT", "AI provider returned non-JSON");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new AppError("AI_INVALID_OUTPUT", "AI provider returned an empty completion");
  }

  return { content, model: payload.model ?? endpoint.model };
}
