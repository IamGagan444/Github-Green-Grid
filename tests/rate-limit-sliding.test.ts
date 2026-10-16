import { beforeEach, describe, expect, it } from "vitest";

import { memoryRateLimitAt, rateLimitHeaders, resetMemoryRateLimits, slidingWindowDecision } from "@/lib/rate-limit";

const options = { limit: 10, windowSeconds: 60 };
const WINDOW = 60_000;
const start = 1_000 * WINDOW; // aligned to a window boundary

beforeEach(() => resetMemoryRateLimits());

describe("sliding-window rate limit", () => {
  it("blocks a burst that straddles a window boundary (a fixed window would allow 2x)", () => {
    // 10 requests in the last second of window N…
    for (let i = 0; i < 10; i += 1) expect(memoryRateLimitAt("ip", options, start + WINDOW - 1_000).success).toBe(true);
    // …and the first second of window N+1 still sees ~9.8 weighted requests, so
    // at most one more fits (a fixed window would allow 10 more).
    let allowed = 0;
    for (let i = 0; i < 10; i += 1) if (memoryRateLimitAt("ip", options, start + WINDOW + 1_000).success) allowed += 1;
    expect(allowed).toBeLessThanOrEqual(1);
  });

  it("recovers gradually as the previous window's weight decays", () => {
    for (let i = 0; i < 10; i += 1) memoryRateLimitAt("ip", options, start + 30_000);
    // Halfway through the next window, the previous 10 count as 5.
    let allowed = 0;
    for (let i = 0; i < 10; i += 1) if (memoryRateLimitAt("ip", options, start + WINDOW + 30_000).success) allowed += 1;
    expect(allowed).toBe(5);
  });

  it("rejected requests are not counted", () => {
    for (let i = 0; i < 10; i += 1) memoryRateLimitAt("ip", options, start + 1_000);
    for (let i = 0; i < 50; i += 1) memoryRateLimitAt("ip", options, start + 2_000);
    // After a full idle window plus one, the client is fully allowed again.
    expect(memoryRateLimitAt("ip", options, start + 2 * WINDOW + 1_000).success).toBe(true);
  });

  it("reports Retry-After when blocked", () => {
    for (let i = 0; i < 10; i += 1) memoryRateLimitAt("ip", options, start + 10_000);
    const blocked = memoryRateLimitAt("ip", options, start + 10_000);
    expect(blocked.success).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(rateLimitHeaders(blocked)["Retry-After"]).toBe(String(blocked.retryAfterSeconds));
    expect(rateLimitHeaders({ ...blocked, success: true })["Retry-After"]).toBeUndefined();
  });

  it("the retry hint is long enough to actually be allowed", () => {
    const decision = slidingWindowDecision({ limit: 10, windowMs: WINDOW, now: start + 20_000, previous: 10, current: 4 });
    expect(decision.allowed).toBe(false);
    const later = slidingWindowDecision({
      limit: 10,
      windowMs: WINDOW,
      now: start + 20_000 + decision.retryAfterMs,
      previous: 10,
      current: 4,
    });
    expect(later.allowed).toBe(true);
  });
});
