import "server-only";

import { after } from "next/server";

import { getAppUrl, getEnv } from "@/lib/env";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("cron-continuation");

export const HOP_HEADER = "x-greengrid-hop";
/** Each tick may chain at most this many follow-up invocations. */
export const MAX_HOPS = 3;

export function currentHop(headers: Headers): number {
  const hop = Number(headers.get(HOP_HEADER) ?? "0");
  return Number.isInteger(hop) && hop >= 0 && hop <= MAX_HOPS ? hop : MAX_HOPS;
}

/**
 * When a tick ran out of time with work left, trigger the same cron route
 * again (a fresh 60-second function) instead of waiting 15 minutes. Bounded by
 * MAX_HOPS so a backlog can never turn into an invocation loop. The request is
 * fired and abandoned after a few seconds; the follow-up runs independently.
 */
export function continueIfBacklogged(job: string, deferred: number, headers: Headers): boolean {
  const hop = currentHop(headers);
  if (deferred <= 0 || hop >= MAX_HOPS) return false;

  after(async () => {
    try {
      await fetch(`${getAppUrl()}/api/cron/${job}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getEnv().CRON_SECRET}`, [HOP_HEADER]: String(hop + 1) },
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      // Expected: the follow-up keeps running after we stop waiting for it.
    }
    log.info("cron continuation triggered", { job, hop: hop + 1, deferred });
  });
  return true;
}
