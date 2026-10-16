import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cache, cacheKeys, getCacheMetrics, resetCacheState } = await import("@/lib/cache/cache");
const { isRedisAvailable, resetRedisState } = await import("@/lib/cache/redis");

const KEY = cacheKeys.user("alice", "gh", "repos");

describe("cache (in-memory fallback)", () => {
  beforeEach(() => {
    resetRedisState();
    resetCacheState();
  });

  it("serves the second read from cache", async () => {
    const loader = vi.fn(async () => ["repo-a"]);
    expect(await cache.getOrSet(KEY, 60, loader)).toEqual(["repo-a"]);
    expect(await cache.getOrSet(KEY, 60, loader)).toEqual(["repo-a"]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(getCacheMetrics()).toMatchObject({ hits: 1, misses: 1, loads: 1 });
  });

  it("bypass skips the read but refreshes the stored value", async () => {
    await cache.getOrSet(KEY, 60, async () => ["old"]);
    expect(await cache.getOrSet(KEY, 60, async () => ["new"], { bypass: true })).toEqual(["new"]);
    expect(await cache.getOrSet(KEY, 60, async () => ["unused"])).toEqual(["new"]);
  });

  it("never caches a failed load", async () => {
    await expect(cache.getOrSet(KEY, 60, async () => Promise.reject(new Error("revoked")))).rejects.toThrow("revoked");
    expect(await cache.getOrSet(KEY, 60, async () => ["fresh"])).toEqual(["fresh"]);
  });

  it("expires entries after their TTL", async () => {
    vi.useFakeTimers();
    try {
      await cache.getOrSet(KEY, 1, async () => ["first"]);
      vi.advanceTimersByTime(1_500);
      expect(await cache.getOrSet(KEY, 1, async () => ["second"])).toEqual(["second"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes keys (invalidation)", async () => {
    await cache.getOrSet(KEY, 60, async () => ["first"]);
    await cache.del([KEY]);
    expect(await cache.getOrSet(KEY, 60, async () => ["second"])).toEqual(["second"]);
  });

  it("concurrent misses share one loader call (single-flight)", async () => {
    let release!: (value: string[]) => void;
    const loader = vi.fn(() => new Promise<string[]>((resolve) => (release = resolve)));
    const pending = Promise.all([cache.getOrSet(KEY, 60, loader), cache.getOrSet(KEY, 60, loader), cache.getOrSet(KEY, 60, loader)]);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    release(["once"]);
    expect(await pending).toEqual([["once"], ["once"], ["once"]]);
    expect(getCacheMetrics().sharedLoads).toBe(2);
  });
});

describe("cache keys", () => {
  it("are versioned and scoped to a user", () => {
    expect(cacheKeys.user("u1", "ig", "media", "first")).toBe("v1:u:u1:ig:media:first");
    expect(cacheKeys.global("hn", "top")).toBe("v1:g:hn:top");
  });

  it("refuses unscoped keys, missing TTLs and odd segments", async () => {
    await expect(cache.get("repos")).rejects.toThrow(/cacheKeys/);
    await expect(cache.set(KEY, 1, 0)).rejects.toThrow(/ttlSeconds/);
    expect(() => cacheKeys.user("a:b", "x")).toThrow();
    expect(() => cacheKeys.user("u1", "has space")).toThrow();
  });

  it("different users never share an entry", async () => {
    resetCacheState();
    await cache.getOrSet(cacheKeys.user("alice", "slack", "channels"), 60, async () => ["alice-only"]);
    expect(await cache.getOrSet(cacheKeys.user("bob", "slack", "channels"), 60, async () => ["bob"])).toEqual(["bob"]);
  });
});

describe("cache (Upstash)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    resetRedisState();
    resetCacheState();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("returns a Redis hit without calling the loader", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ result: [JSON.stringify(["cached"])] }]));
    const loader = vi.fn(async () => ["live"]);
    expect(await cache.getOrSet(KEY, 60, loader)).toEqual(["cached"]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("reads many keys with one MGET command", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ result: [JSON.stringify(1), null] }]));
    expect(await cache.mget([cacheKeys.user("a", "x"), cacheKeys.user("a", "y")])).toEqual([1, null]);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as string[][];
    expect(body).toEqual([["MGET", "gg:v1:u:a:x", "gg:v1:u:a:y"]]);
    expect(getCacheMetrics().redisCommands).toBe(1);
  });

  it("falls back to the loader and stops calling a failing Redis", async () => {
    fetchMock.mockRejectedValue(new Error("connect timeout"));
    const loader = vi.fn(async () => ["live"]);

    expect(await cache.getOrSet(KEY, 60, loader)).toEqual(["live"]);
    expect(isRedisAvailable()).toBe(false);
    const callsAfterTrip = fetchMock.mock.calls.length;

    expect(await cache.getOrSet(KEY, 60, loader)).toEqual(["live"]);
    expect(fetchMock.mock.calls.length).toBe(callsAfterTrip);
  });
});
