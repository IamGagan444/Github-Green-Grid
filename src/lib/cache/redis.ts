import "server-only";

import { createLogger } from "@/lib/logging/logger";

/**
 * Upstash Redis transport over its REST API. Used by the rate limiter, the
 * token buckets and the application cache (`lib/cache/cache.ts`).
 *
 * Redis is an optimisation, never a dependency: every call has a short timeout,
 * failures open a circuit breaker so an unreachable Redis costs one slow request
 * rather than every request, and callers fall back to the source of truth.
 * Without Upstash credentials an in-process store is used (local development).
 */

const log = createLogger("redis");

const REQUEST_TIMEOUT_MS = 1_500;
const BREAKER_COOLDOWN_MS = 30_000;

type Command = Array<string | number>;

let breakerOpenUntil = 0;
/** Commands sent since this instance started (development diagnostics). */
let commandCount = 0;

export function getRedisCommandCount(): number {
  return commandCount;
}

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
  commandCount += commands.length;

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

/** Test helper. */
export function resetRedisState(): void {
  breakerOpenUntil = 0;
}
