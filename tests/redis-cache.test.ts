import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cached, cacheDelete, isRedisAvailable, resetRedisState } from "@/lib/cache/redis";

describe("cached (in-memory fallback)", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRedisState();
  });

  it("serves the second read from cache", async () => {
    const loader = vi.fn(async () => ["repo-a"]);
    expect(await cached("k", 60, loader)).toEqual(["repo-a"]);
    expect(await cached("k", 60, loader)).toEqual(["repo-a"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("bypass skips the read but refreshes the stored value", async () => {
    await cached("k", 60, async () => ["old"]);
    expect(await cached("k", 60, async () => ["new"], { bypass: true })).toEqual(["new"]);
    expect(await cached("k", 60, async () => ["unused"])).toEqual(["new"]);
  });

  it("never caches a failed load", async () => {
    await expect(cached("k", 60, async () => Promise.reject(new Error("revoked")))).rejects.toThrow("revoked");
    expect(await cached("k", 60, async () => ["fresh"])).toEqual(["fresh"]);
  });

  it("expires entries after their TTL", async () => {
    vi.useFakeTimers();
    try {
      await cached("k", 1, async () => ["first"]);
      vi.advanceTimersByTime(1_500);
      expect(await cached("k", 1, async () => ["second"])).toEqual(["second"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes keys", async () => {
    await cached("k", 60, async () => ["first"]);
    await cacheDelete(["k"]);
    expect(await cached("k", 60, async () => ["second"])).toEqual(["second"]);
  });
});

describe("cached (Upstash)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    resetRedisState();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("returns a Redis hit without calling the loader", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ result: JSON.stringify(["cached"]) }]));
    const loader = vi.fn(async () => ["live"]);
    expect(await cached("k", 60, loader)).toEqual(["cached"]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("falls back to the loader and stops calling a failing Redis", async () => {
    fetchMock.mockRejectedValue(new Error("connect timeout"));
    const loader = vi.fn(async () => ["live"]);

    expect(await cached("k", 60, loader)).toEqual(["live"]);
    expect(isRedisAvailable()).toBe(false);
    const callsAfterTrip = fetchMock.mock.calls.length;

    expect(await cached("k", 60, loader)).toEqual(["live"]);
    expect(fetchMock.mock.calls.length).toBe(callsAfterTrip);
  });
});
