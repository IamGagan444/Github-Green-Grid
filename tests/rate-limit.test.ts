import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RATE_LIMITS, rateLimit, rateLimitHeaders, resetMemoryRateLimits } from "@/lib/rate-limit";

beforeEach(() => {
  resetMemoryRateLimits();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  resetMemoryRateLimits();
});

describe("in-memory rate limiter", () => {
  it("allows requests up to the limit", async () => {
    const options = { limit: 3, windowSeconds: 60 };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await rateLimit("key", options);
      expect(result.success).toBe(true);
    }
  });

  it("blocks the request past the limit", async () => {
    const options = { limit: 2, windowSeconds: 60 };

    await rateLimit("key", options);
    await rateLimit("key", options);
    const blocked = await rateLimit("key", options);

    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("counts each key independently", async () => {
    const options = { limit: 1, windowSeconds: 60 };

    expect((await rateLimit("user_a", options)).success).toBe(true);
    expect((await rateLimit("user_b", options)).success).toBe(true);
    expect((await rateLimit("user_a", options)).success).toBe(false);
  });

  it("reports a decreasing remaining count", async () => {
    const options = { limit: 5, windowSeconds: 60 };

    expect((await rateLimit("key", options)).remaining).toBe(4);
    expect((await rateLimit("key", options)).remaining).toBe(3);
  });
});

describe("rateLimitHeaders", () => {
  it("emits standard headers with a second-precision reset", () => {
    const headers = rateLimitHeaders({
      success: true,
      limit: 10,
      remaining: 7,
      reset: 1_756_000_000_000,
    });

    expect(headers["X-RateLimit-Limit"]).toBe("10");
    expect(headers["X-RateLimit-Remaining"]).toBe("7");
    expect(headers["X-RateLimit-Reset"]).toBe("1756000000");
  });
});

describe("configured limits", () => {
  it("keeps manual runs tightly bounded", () => {
    expect(RATE_LIMITS.manualRun.limit).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.manualRun.windowSeconds).toBeGreaterThanOrEqual(60);
  });
});
