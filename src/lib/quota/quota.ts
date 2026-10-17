import type { QuotaScope } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { addDaysToDayKey, formatDayKey, getWallClock, zonedTimeToUtc } from "@/lib/schedule/timezone";

/**
 * Daily metering of shared quotas (YouTube API units, Gmail sends, Telegram
 * and WhatsApp messages). Each reservation is a compare-and-swap increment
 * that only succeeds while `used + units <= cap`, so concurrent workers can never
 * overshoot a cap. A per-user reservation is taken first, then the global one;
 * if the global cap is full the user's reservation is given back.
 */

export const GLOBAL_SUBJECT = "global";

/** Timezone in which each quota resets. YouTube resets at midnight Pacific. */
const RESET_TIMEZONE: Record<QuotaScope, string> = {
  YOUTUBE_UNITS: "America/Los_Angeles",
  EMAILS: "UTC",
  TELEGRAM_MESSAGES: "UTC",
  WHATSAPP_MESSAGES: "UTC",
};

export function quotaDay(scope: QuotaScope, now: Date): string {
  const wall = getWallClock(now, RESET_TIMEZONE[scope]);
  return formatDayKey(wall.year, wall.month, wall.day);
}

/** The instant the current quota day ends. */
export function quotaResetsAt(scope: QuotaScope, now: Date): Date {
  const next = addDaysToDayKey(quotaDay(scope, now), 1);
  const [year, month, day] = next.split("-").map(Number) as [number, number, number];
  return zonedTimeToUtc(year, month, day, 0, 0, RESET_TIMEZONE[scope]);
}

export interface QuotaStore {
  /** Atomically adds `units` when `used + units <= cap`; false otherwise. */
  tryIncrement(scope: QuotaScope, subject: string, day: string, units: number, cap: number): Promise<boolean>;
  decrement(scope: QuotaScope, subject: string, day: string, units: number): Promise<void>;
  used(scope: QuotaScope, subject: string, day: string): Promise<number>;
}

export interface QuotaCaps {
  user: number;
  global: number | null;
}

export interface Reservation {
  release(): Promise<void>;
}

/**
 * Reserves `units` for `userId`, or throws a retryable QUOTA_EXHAUSTED whose
 * `retryAfterMs` points at the next reset.
 */
export async function reserveQuota(
  store: QuotaStore,
  input: { scope: QuotaScope; userId: string; units: number; caps: QuotaCaps; now: Date },
): Promise<Reservation> {
  const { scope, userId, units, caps, now } = input;
  const day = quotaDay(scope, now);
  const exhausted = (who: string) =>
    new AppError("QUOTA_EXHAUSTED", `${scope} ${who} quota exhausted for ${day}`, {
      retryAfterMs: Math.max(quotaResetsAt(scope, now).getTime() - now.getTime(), 60_000),
    });

  if (!(await store.tryIncrement(scope, userId, day, units, caps.user))) throw exhausted("user");

  if (caps.global !== null) {
    const ok = await store.tryIncrement(scope, GLOBAL_SUBJECT, day, units, caps.global);
    if (!ok) {
      await store.decrement(scope, userId, day, units);
      throw exhausted("global");
    }
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await store.decrement(scope, userId, day, units);
      if (caps.global !== null) await store.decrement(scope, GLOBAL_SUBJECT, day, units);
    },
  };
}

/** In-memory store with the same semantics, for tests and local scripts. */
export class MemoryQuotaStore implements QuotaStore {
  readonly rows = new Map<string, number>();

  private key(scope: QuotaScope, subject: string, day: string) {
    return `${scope}|${subject}|${day}`;
  }

  async tryIncrement(scope: QuotaScope, subject: string, day: string, units: number, cap: number) {
    const key = this.key(scope, subject, day);
    const used = this.rows.get(key) ?? 0;
    if (used + units > cap) return false;
    this.rows.set(key, used + units);
    return true;
  }

  async decrement(scope: QuotaScope, subject: string, day: string, units: number) {
    const key = this.key(scope, subject, day);
    this.rows.set(key, Math.max(0, (this.rows.get(key) ?? 0) - units));
  }

  async used(scope: QuotaScope, subject: string, day: string) {
    return this.rows.get(this.key(scope, subject, day)) ?? 0;
  }
}
