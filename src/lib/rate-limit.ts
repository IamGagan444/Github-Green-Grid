import "server-only";

/**
 * Provider-agnostic fixed-window rate limiter.
 *
 * Uses Upstash Redis over its REST API when UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are set; otherwise falls back to an in-memory map.
 * The in-memory limiter is per-instance and is intended for local development
 * only — set the Upstash variables for multi-instance deployments.
 */

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Unix ms timestamp at which the current window resets. */
  reset: number;
}

export interface RateLimitOptions {
  /** Max requests allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export const RATE_LIMITS = {
  repositories: { limit: 30, windowSeconds: 60 },
  scheduleWrite: { limit: 20, windowSeconds: 60 },
  manualRun: { limit: 5, windowSeconds: 300 },
  cron: { limit: 60, windowSeconds: 60 },
  auth: { limit: 10, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitOptions>;

const memoryStore = new Map<string, { count: number; reset: number }>();

function memoryLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const windowMs = options.windowSeconds * 1000;
  const entry = memoryStore.get(key);

  if (!entry || entry.reset <= now) {
    const reset = now + windowMs;
    memoryStore.set(key, { count: 1, reset });
    return { success: true, limit: options.limit, remaining: options.limit - 1, reset };
  }

  entry.count += 1;
  const remaining = Math.max(0, options.limit - entry.count);
  return {
    success: entry.count <= options.limit,
    limit: options.limit,
    remaining,
    reset: entry.reset,
  };
}

async function redisLimit(
  key: string,
  options: RateLimitOptions,
  url: string,
  token: string,
): Promise<RateLimitResult> {
  const windowMs = options.windowSeconds * 1000;
  const bucket = Math.floor(Date.now() / windowMs);
  const redisKey = `greengrid:rl:${key}:${bucket}`;
  const reset = (bucket + 1) * windowMs;

  const response = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, String(options.windowSeconds + 1)],
    ]),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Upstash responded with ${response.status}`);
  }

  const payload = (await response.json()) as Array<{ result?: number | string }>;
  const count = Number(payload[0]?.result ?? 0);

  return {
    success: count <= options.limit,
    limit: options.limit,
    remaining: Math.max(0, options.limit - count),
    reset,
  };
}

/**
 * Consumes one token for `key`. Never throws — a failing Redis backend
 * degrades to allowing the request rather than locking users out.
 */
export async function rateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      return await redisLimit(key, options, url, token);
    } catch (error) {
      console.error("[rate-limit] Redis backend unavailable, allowing request", error);
      return { success: true, limit: options.limit, remaining: options.limit, reset: Date.now() };
    }
  }

  return memoryLimit(key, options);
}

/** Test helper: clears the in-memory bucket store. */
export function resetMemoryRateLimits(): void {
  memoryStore.clear();
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
  };
}
