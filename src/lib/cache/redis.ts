import "server-only";

import { createLogger } from "@/lib/logging/logger";

/**
 * Upstash Redis over its REST API, used for rate limiting and for caching slow
 * third-party reads (GitHub repositories/branches, Slack channels).
 *
 * Redis is an optimisation, never a dependency: every call has a short timeout,
 * failures open a circuit breaker so an unreachable Redis costs one slow request
 * rather than every request, and callers fall back to the source of truth.
 * Without Upstash credentials an in-process store is used (local development).
 */

const log = createLogger("redis");

const REQUEST_TIMEOUT_MS = 1_500;
const BREAKER_COOLDOWN_MS = 30_000;
const MEMORY_MAX_ENTRIES = 500;
const KEY_PREFIX = "greengrid:";

type Command = Array<string | number>;

let breakerOpenUntil = 0;

function credentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function isRedisConfigured(): boolean {
  return credentials() !== null;
}

/** True when Redis is configured and not currently tripped. */
export function isRedisAvailable(): boolean {
  return isRedisConfigured() && Date.now() >= breakerOpenUntil;
}

/**
 * Runs commands as one pipeline. Throws on any failure (and trips the breaker);
 * callers decide how to degrade.
 */
export async function redisPipeline(commands: Command[]): Promise<unknown[]> {
  const creds = credentials();
  if (!creds) throw new Error("Redis is not configured");
  if (Date.now() < breakerOpenUntil) throw new Error("Redis circuit is open");

  try {
    const response = await fetch(`${creds.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands.map((command) => command.map(String))),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Upstash responded with ${response.status}`);

    const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const failed = payload.find((entry) => entry.error);
    if (failed) throw new Error(`Upstash command failed: ${failed.error}`);
    return payload.map((entry) => entry.result);
  } catch (error) {
    breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    log.warn("redis unavailable, bypassing for cooldown", {
      cooldownMs: BREAKER_COOLDOWN_MS,
      error: error as Error,
    });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local fallback store
// ─────────────────────────────────────────────────────────────────────────────

const memory = new Map<string, { value: string; expiresAt: number }>();

function memoryGet(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key: string, value: string, ttlSeconds: number): void {
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache API
// ─────────────────────────────────────────────────────────────────────────────

async function cacheGet<T>(key: string): Promise<T | null> {
  const fullKey = KEY_PREFIX + key;
  let raw: string | null = null;

  if (!isRedisConfigured()) {
    raw = memoryGet(fullKey);
  } else if (isRedisAvailable()) {
    try {
      const [result] = await redisPipeline([["GET", fullKey]]);
      raw = typeof result === "string" ? result : null;
    } catch {
      return null;
    }
  }

  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const fullKey = KEY_PREFIX + key;
  const raw = JSON.stringify(value);

  if (!isRedisConfigured()) {
    memorySet(fullKey, raw, ttlSeconds);
    return;
  }
  if (!isRedisAvailable()) return;
  try {
    await redisPipeline([["SET", fullKey, raw, "EX", ttlSeconds]]);
  } catch {
    // Already logged; the value is simply not cached.
  }
}

export async function cacheDelete(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const fullKeys = keys.map((key) => KEY_PREFIX + key);

  if (!isRedisConfigured()) {
    for (const key of fullKeys) memory.delete(key);
    return;
  }
  if (!isRedisAvailable()) return;
  try {
    await redisPipeline([["DEL", ...fullKeys]]);
  } catch {
    // Keys expire on their own TTL.
  }
}

/**
 * Read-through cache. Only successful loader results are cached, so errors
 * (revoked tokens, rate limits) are never replayed from cache.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  options: { bypass?: boolean } = {},
): Promise<T> {
  if (!options.bypass) {
    const hit = await cacheGet<T>(key);
    if (hit !== null) return hit;
  }
  const value = await loader();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

/** Test helper. */
export function resetRedisState(): void {
  memory.clear();
  breakerOpenUntil = 0;
}
