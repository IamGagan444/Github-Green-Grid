/** Browser-side fetch wrapper. Surfaces the API's user-safe error message. */

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export async function apiFetch<TResponse>(
  input: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let envelope: ErrorEnvelope = {};
    try {
      envelope = (await response.json()) as ErrorEnvelope;
    } catch {
      // Non-JSON error bodies fall through to the generic message below.
    }

    throw new ApiRequestError(
      envelope.error?.code ?? "INTERNAL_ERROR",
      envelope.error?.message ?? "Something went wrong. Please try again.",
      response.status,
    );
  }

  return (await response.json()) as TResponse;
}

export function messageFor(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return "Something went wrong. Please try again.";
}
