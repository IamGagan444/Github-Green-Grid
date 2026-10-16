import "server-only";

import { isRedisAvailable, isRedisConfigured, redisPipeline } from "@/lib/cache/redis";
import { createLogger } from "@/lib/logging/logger";

/**
 * The application cache. One interface over Upstash Redis with an in-process
 * fallback (local development, or while Redis is unreachable).
 *
 * Rules, enforced here rather than by convention:
 *  - Every key is versioned and scoped: `v1:u:<userId>:…` for one user's data,
 *    `v1:g:…` for data that is identical for everyone. Anything else throws, so
 *    one user's data can never be cached under a key another user reads.
 *  - Every write has a TTL.
 *  - Values are JSON of non-secret data. Tokens are never cached.
 *  - `getOrSet` is single-flight per instance: concurrent misses for a key
 *    share one loader call.
 *
 * What is cached (and why only this): third-party API reads that take
 * 300–1,000 ms. Database queries are not cached in Redis: functions, Neon and
 * Upstash all run in Singapore, where a pooled Neon query takes 1–3 ms and an
 * Upstash REST call (a full HTTPS request) is no faster, so caching them
 * would add work without saving time.
 *
 *   | Data                                   | TTL    | Invalidation                    |
 *   | -------------------------------------- | ------ | ------------------------------- |
 *   | GitHub repositories (per connection)   | 5 min  | Refresh button; key has connectedAt |
 *   | GitHub branches (per repository)       | 5 min  | Refresh button; key has connectedAt |
 *   | Slack channels (per workspace, mode)   | 5 min  | Refresh button; key has connectedAt |
 *   | Instagram media page (per cursor)      | 5 min  | Refresh button; key has connectedAt |
 *
 * Including the connection time in the key means reconnecting an account
 * starts from a clean cache without any explicit delete.
 */

const log = createLogger("cache");

const STORE_PREFIX = "gg:";
const KEY_VERSION = "v1";
const MEMORY_MAX_ENTRIES = 500;
const MAX_TTL_SECONDS = 24 * 60 * 60;

export const cacheKeys = {
  /** A key that holds data belonging to one user. */
  user(userId: string, ...parts: Array<string | number>): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new Error("cache: invalid user id");
    return [KEY_VERSION, "u", userId, ...parts.map(segment)].join(":");
  },
  /** A key that holds data identical for every user (never user data). */
  global(...parts: Array<string | number>): string {
    return [KEY_VERSION, "g", ...parts.map(segment)].join(":");
  },
};

function segment(part: string | number): string {
  const value = String(part);
  if (value.length === 0 || value.length > 200 || /[\s\u0000-\u001f]/.test(value)) {
    throw new Error("cache: invalid key segment");
  }
  return value;
}

function assertScopedKey(key: string): void {
  if (!key.startsWith(`${KEY_VERSION}:u:`) && !key.startsWith(`${KEY_VERSION}:g:`)) {
    throw new Error("cache: keys must come from cacheKeys.user() or cacheKeys.global()");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics (development diagnostics only; never exposed in production)
// ─────────────────────────────────────────────────────────────────────────────

export interface CacheMetrics {
  hits: number;
  misses: number;
  loads: number;
  /** Concurrent misses that joined an in-flight load instead of calling the loader. */
  sharedLoads: number;
  redisCommands: number;
  errors: number;
}

const metrics: CacheMetrics = { hits: 0, misses: 0, loads: 0, sharedLoads: 0, redisCommands: 0, errors: 0 };

export function getCacheMetrics(): CacheMetrics & { backend: "redis" | "memory" } {
  return { ...metrics, backend: isRedisConfigured() ? "redis" : "memory" };
}

export function resetCacheMetrics(): void {
  for (const key of Object.keys(metrics) as Array<keyof CacheMetrics>) metrics[key] = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backends
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

async function run(commands: Array<Array<string | number>>): Promise<unknown[]> {
  metrics.redisCommands += commands.length;
  return redisPipeline(commands);
}

function parse<T>(raw: unknown): T | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CachePort
// ─────────────────────────────────────────────────────────────────────────────

export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  /** One round trip for many keys. */
  mget<T>(keys: string[]): Promise<Array<T | null>>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(keys: string[]): Promise<void>;
  /**
   * Read-through: returns the cached value or runs `loader` once (shared by
   * concurrent callers) and caches its result. Failed loads are never cached.
   */
  getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>, options?: { bypass?: boolean }): Promise<T>;
}

const inFlight = new Map<string, Promise<unknown>>();

async function mgetRaw(keys: string[]): Promise<Array<string | null>> {
  const fullKeys = keys.map((key) => STORE_PREFIX + key);
  if (!isRedisConfigured()) return fullKeys.map(memoryGet);
  if (!isRedisAvailable()) return fullKeys.map(() => null);
  try {
    const [result] = await run([["MGET", ...fullKeys]]);
    return Array.isArray(result) ? result.map((entry) => (typeof entry === "string" ? entry : null)) : fullKeys.map(() => null);
  } catch {
    metrics.errors += 1;
    return fullKeys.map(() => null);
  }
}

export const cache: CachePort = {
  async get<T>(key: string) {
    const [value] = await cache.mget<T>([key]);
    return value ?? null;
  },

  async mget<T>(keys: string[]) {
    keys.forEach(assertScopedKey);
    if (keys.length === 0) return [];
    return (await mgetRaw(keys)).map((raw) => parse<T>(raw));
  },

  async set(key, value, ttlSeconds) {
    assertScopedKey(key);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
      throw new Error("cache: ttlSeconds must be an integer between 1 and 86400");
    }
    const raw = JSON.stringify(value);
    const fullKey = STORE_PREFIX + key;
    if (!isRedisConfigured()) {
      memorySet(fullKey, raw, ttlSeconds);
      return;
    }
    if (!isRedisAvailable()) return;
    try {
      await run([["SET", fullKey, raw, "EX", ttlSeconds]]);
    } catch {
      metrics.errors += 1;
    }
  },

  async del(keys) {
    keys.forEach(assertScopedKey);
    if (keys.length === 0) return;
    const fullKeys = keys.map((key) => STORE_PREFIX + key);
    if (!isRedisConfigured()) {
      for (const key of fullKeys) memory.delete(key);
      return;
    }
    if (!isRedisAvailable()) return;
    try {
      await run([["DEL", ...fullKeys]]);
    } catch {
      metrics.errors += 1;
    }
  },

  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>, options: { bypass?: boolean } = {}) {
    assertScopedKey(key);
    if (!options.bypass) {
      const hit = await cache.get<T>(key);
      if (hit !== null) {
        metrics.hits += 1;
        return hit;
      }
    }
    metrics.misses += 1;

    const pending = inFlight.get(key) as Promise<T> | undefined;
    if (pending) {
      metrics.sharedLoads += 1;
      return pending;
    }

    const load = (async () => {
      metrics.loads += 1;
      const value = await loader();
      await cache.set(key, value, ttlSeconds);
      return value;
    })();
    inFlight.set(key, load);
    try {
      return await load;
    } finally {
      inFlight.delete(key);
      if (process.env.NODE_ENV === "development") log.debug("cache load", { key: key.replace(/:u:[^:]+/, ":u:*") });
    }
  },
};

/** Test helper. */
export function resetCacheState(): void {
  memory.clear();
  inFlight.clear();
  resetCacheMetrics();
}
