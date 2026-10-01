import "server-only";

import { isRedisAvailable, redisPipeline } from "@/lib/cache/redis";

/**
 * Provider-agnostic fixed-window rate limiter.
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 * are set; otherwise (or while Redis is unreachable) an in-memory map. The
 * in-memory limiter is per-instance — set the Upstash variables for
 * multi-instance deployments.
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
  integrationConnect: { limit: 10, windowSeconds: 300 },
  integrationRead: { limit: 60, windowSeconds: 60 },
  automationWrite: { limit: 30, windowSeconds: 60 },
  automationTest: { limit: 6, windowSeconds: 300 },
  automationRun: { limit: 5, windowSeconds: 300 },
  adminWrite: { limit: 30, windowSeconds: 60 },
  webhook: { limit: 120, windowSeconds: 60 },
  settingsWrite: { limit: 20, windowSeconds: 60 },
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

async function redisLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  const windowMs = options.windowSeconds * 1000;
  const bucket = Math.floor(Date.now() / windowMs);
  const redisKey = `greengrid:rl:${key}:${bucket}`;
  const reset = (bucket + 1) * windowMs;

  const [result] = await redisPipeline([
    ["INCR", redisKey],
    ["EXPIRE", redisKey, options.windowSeconds + 1],
  ]);
  const count = Number(result ?? 0);

  return {
    success: count <= options.limit,
    limit: options.limit,
    remaining: Math.max(0, options.limit - count),
    reset,
  };
}

/**
 * Consumes one token for `key`. Never throws: when Redis is unreachable the
 * per-instance memory limiter still applies, rather than locking users out or
 * dropping protection entirely.
 */
export async function rateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  if (isRedisAvailable()) {
    try {
      return await redisLimit(key, options);
    } catch {
      // Logged by the Redis client; fall through to the local limiter.
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
