import { isAppError } from "@/lib/errors";

export interface RetryOptions {
  /** Total attempts including the first. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Decides whether a failure is transient. Defaults to `AppError#retryable`. */
  shouldRetry?: (error: unknown) => boolean;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultShouldRetry(error: unknown): boolean {
  return isAppError(error) && error.retryable;
}

/**
 * Exponential backoff with full jitter: delay = random(0, min(max, base·2^n)).
 * A provider-supplied `retryAfterMs` takes precedence when it is larger.
 * Permanent failures are rethrown immediately.
 */
export function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !shouldRetry(error)) throw error;

      const hinted = isAppError(error) && error.retryAfterMs ? Math.min(error.retryAfterMs, maxDelayMs) : 0;
      await sleep(Math.max(hinted, backoffDelay(attempt, baseDelayMs, maxDelayMs, random)));
    }
  }

  throw lastError;
}
