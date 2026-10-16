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
  // Meta batches and retries deliveries from a small set of IPs.
  instagramWebhook: { limit: 600, windowSeconds: 60 },
  // GitHub delivers from a small pool of hook IPs.
  githubWebhook: { limit: 600, windowSeconds: 60 },
  // Public form endpoints (per client IP, and per form).
  formSubmitIp: { limit: 5, windowSeconds: 60 },
  formSubmitForm: { limit: 60, windowSeconds: 3600 },
  // Per Instagram account. Meta allows ~750 private replies/hour; stay under it.
  instagramSend: { limit: 600, windowSeconds: 3600 },
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

// ─────────────────────────────────────────────────────────────────────────────
// Smooth rate limiting (GCRA token bucket) for outbound provider limits, such
// as Telegram's ~30 msg/s per bot and 1 msg/s per chat.
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenBucketOptions {
  /** Sustained requests per second. */
  ratePerSecond: number;
  /** Requests allowed back to back before smoothing kicks in. */
  burst: number;
}

const gcraStore = new Map<string, number>();

/** Milliseconds to wait before a request is allowed; 0 means allowed now (and consumed). */
export function gcraWaitMs(
  store: Map<string, number>,
  key: string,
  options: TokenBucketOptions,
  now: number,
): number {
  const interval = 1000 / options.ratePerSecond;
  const tolerance = interval * Math.max(options.burst - 1, 0);
  const tat = Math.max(store.get(key) ?? now, now);
  const allowAt = tat - tolerance;
  if (now < allowAt) return Math.ceil(allowAt - now);
  store.set(key, tat + interval);
  if (store.size > 10_000) {
    // Drop stale keys; a key whose TAT has passed carries no state.
    for (const [entry, value] of store) if (value < now) store.delete(entry);
  }
  return 0;
}

const GCRA_SCRIPT = `
local tat = tonumber(redis.call('GET', KEYS[1]) or ARGV[1])
local now = tonumber(ARGV[1])
if tat < now then tat = now end
local allow_at = tat - tonumber(ARGV[3])
if now < allow_at then return math.ceil(allow_at - now) end
local new_tat = tat + tonumber(ARGV[2])
redis.call('SET', KEYS[1], tostring(new_tat), 'PX', math.ceil(new_tat - now) + 1000)
return 0`;

/**
 * Takes one token from a shared bucket. Distributed through Upstash when
 * configured (one EVAL per call); otherwise per instance. Never throws.
 */
export async function acquireToken(key: string, options: TokenBucketOptions): Promise<number> {
  const now = Date.now();
  if (isRedisAvailable()) {
    try {
      const interval = 1000 / options.ratePerSecond;
      const [result] = await redisPipeline([
        ["EVAL", GCRA_SCRIPT, 1, `greengrid:tb:${key}`, now, interval, interval * Math.max(options.burst - 1, 0)],
      ]);
      return Math.max(0, Number(result ?? 0));
    } catch {
      // Logged by the Redis client; fall through to the local bucket.
    }
  }
  return gcraWaitMs(gcraStore, key, options, now);
}

/** Waits (up to `maxWaitMs`) for a token from every bucket; false when the wait would be longer. */
export async function waitForTokens(
  buckets: Array<{ key: string; options: TokenBucketOptions }>,
  maxWaitMs: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const deadline = Date.now() + maxWaitMs;
  for (const bucket of buckets) {
    for (;;) {
      const wait = await acquireToken(bucket.key, bucket.options);
      if (wait === 0) break;
      if (Date.now() + wait > deadline) return { ok: false, retryAfterMs: wait };
      await sleep(wait);
    }
  }
  return { ok: true };
}

/** Test helper. */
export function resetTokenBuckets(): void {
  gcraStore.clear();
}
