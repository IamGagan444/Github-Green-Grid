import "server-only";

import { isRedisAvailable, redisPipeline } from "@/lib/cache/redis";

/**
 * Sliding-window rate limiter (two-bucket approximation).
 *
 * The estimate is `previous × (unelapsed share of the window) + current`, so
 * a burst straddling a window boundary cannot get twice the limit, which a
 * fixed window allows. Rejected requests are not counted.
 *
 * Uses Upstash Redis when configured, as one atomic EVAL per check; otherwise
 * (or while Redis is unreachable) an in-memory map with the same algorithm.
 * The in-memory limiter is per instance.
 */

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Unix ms timestamp at which the current window ends. */
  reset: number;
  /** Seconds until a request would be allowed again; 0 (or absent) when allowed. */
  retryAfterSeconds?: number;
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
  // Sign-in starts and OAuth callbacks, per client IP.
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
  // Telegram delivers from its own small IP range; the secret header is the real gate.
  telegramWebhook: { limit: 600, windowSeconds: 60 },
  // Public form endpoints (per client IP, and per form).
  formSubmitIp: { limit: 5, windowSeconds: 60 },
  formSubmitForm: { limit: 60, windowSeconds: 3600 },
  // Per Instagram account. Meta allows ~750 private replies/hour; stay under it.
  instagramSend: { limit: 600, windowSeconds: 3600 },
  settingsWrite: { limit: 20, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitOptions>;

/** Pure sliding-window decision, shared by both backends. */
export function slidingWindowDecision(input: {
  limit: number;
  windowMs: number;
  now: number;
  previous: number;
  current: number;
}): { allowed: boolean; estimate: number; retryAfterMs: number; reset: number } {
  const { limit, windowMs, now, previous, current } = input;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const elapsed = now - windowStart;
  const weight = 1 - elapsed / windowMs;
  const estimate = previous * weight + current;
  const reset = windowStart + windowMs;
  if (estimate < limit) return { allowed: true, estimate: estimate + 1, retryAfterMs: 0, reset };

  // When will `previous × weight + current` drop below the limit?
  let retryAfterMs: number;
  if (current < limit && previous > 0) {
    retryAfterMs = (1 - (limit - current) / previous) * windowMs - elapsed;
  } else {
    // The current window alone is full: wait for it to roll over, then for
    // its weight (as the new previous window) to decay enough.
    retryAfterMs = reset - now + Math.max(0, 1 - limit / Math.max(current, 1)) * windowMs;
  }
  // +1 ms: at exactly that instant the estimate equals the limit, which is still blocked.
  return { allowed: false, estimate, retryAfterMs: Math.max(1_000, Math.ceil(retryAfterMs) + 1), reset };
}

function toResult(options: RateLimitOptions, decision: ReturnType<typeof slidingWindowDecision>): RateLimitResult {
  return {
    success: decision.allowed,
    limit: options.limit,
    remaining: decision.allowed ? Math.max(0, Math.floor(options.limit - decision.estimate)) : 0,
    reset: decision.reset,
    retryAfterSeconds: decision.allowed ? 0 : Math.ceil(decision.retryAfterMs / 1000),
  };
}

const memoryStore = new Map<string, { bucket: number; current: number; previous: number }>();

function memoryLimit(key: string, options: RateLimitOptions, now = Date.now()): RateLimitResult {
  const windowMs = options.windowSeconds * 1000;
  const bucket = Math.floor(now / windowMs);
  let entry = memoryStore.get(key);
  if (!entry || entry.bucket < bucket - 1) entry = { bucket, current: 0, previous: 0 };
  else if (entry.bucket === bucket - 1) entry = { bucket, current: 0, previous: entry.current };

  const decision = slidingWindowDecision({ limit: options.limit, windowMs, now, previous: entry.previous, current: entry.current });
  if (decision.allowed) entry.current += 1;
  memoryStore.set(key, entry);

  if (memoryStore.size > 10_000) {
    for (const [stale, value] of memoryStore) if (value.bucket < bucket - 1) memoryStore.delete(stale);
  }
  return toResult(options, decision);
}

/**
 * Reads both buckets and increments the current one only when allowed, in a
 * single atomic EVAL (one Upstash command per check).
 */
const SLIDING_WINDOW_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
local limit = tonumber(ARGV[1])
local weight = tonumber(ARGV[2])
if previous * weight + current >= limit then return {0, current, previous} end
current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
return {1, current - 1, previous}`;

async function redisLimit(key: string, options: RateLimitOptions, now = Date.now()): Promise<RateLimitResult> {
  const windowMs = options.windowSeconds * 1000;
  const bucket = Math.floor(now / windowMs);
  const weight = 1 - (now - bucket * windowMs) / windowMs;

  const [result] = await redisPipeline([
    [
      "EVAL",
      SLIDING_WINDOW_SCRIPT,
      2,
      `greengrid:rl:${key}:${bucket}`,
      `greengrid:rl:${key}:${bucket - 1}`,
      options.limit,
      weight,
      // Each bucket must survive the following window, where it is "previous".
      windowMs * 2 + 1_000,
    ],
  ]);
  const [, current, previous] = (result as [number, number, number] | undefined) ?? [1, 0, 0];
  return toResult(
    options,
    slidingWindowDecision({ limit: options.limit, windowMs, now, previous: Number(previous), current: Number(current) }),
  );
}

/**
 * Consumes one request for `key`. Never throws: when Redis is unreachable the
 * per-instance memory limiter still applies, rather than locking users out or
 * dropping protection entirely.
 */
export async function rateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
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

/** Exposed for tests that need a fixed clock. */
export function memoryRateLimitAt(key: string, options: RateLimitOptions, now: number): RateLimitResult {
  return memoryLimit(key, options, now);
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
    ...(result.success ? {} : { "Retry-After": String(Math.max(1, result.retryAfterSeconds ?? 1)) }),
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
