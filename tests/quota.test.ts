import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { GLOBAL_SUBJECT, MemoryQuotaStore, quotaDay, quotaResetsAt, reserveQuota } from "@/lib/quota/quota";

const now = new Date("2026-10-16T06:30:00Z"); // 23:30 the previous day in Los Angeles (PDT)
const caps = { user: 200, global: 9_000 };

describe("YouTube quota metering", () => {
  it("uses the Pacific day, when YouTube's quota resets", () => {
    expect(quotaDay("YOUTUBE_UNITS", now)).toBe("2026-10-15");
    expect(quotaDay("EMAILS", now)).toBe("2026-10-16");
    expect(quotaResetsAt("YOUTUBE_UNITS", now).toISOString()).toBe("2026-10-16T07:00:00.000Z");
  });

  it("caps each user per day", async () => {
    const store = new MemoryQuotaStore();
    for (let i = 0; i < 200; i += 1) {
      await reserveQuota(store, { scope: "YOUTUBE_UNITS", userId: "u1", units: 1, caps, now });
    }
    const error = await reserveQuota(store, { scope: "YOUTUBE_UNITS", userId: "u1", units: 1, caps, now }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("QUOTA_EXHAUSTED");
    expect((error as AppError).retryable).toBe(true);
    // Retry when the quota resets (30 minutes later here).
    expect((error as AppError).retryAfterMs).toBe(30 * 60_000);

    // Another user is unaffected.
    await expect(reserveQuota(store, { scope: "YOUTUBE_UNITS", userId: "u2", units: 1, caps, now })).resolves.toBeDefined();
  });

  it("stops everyone at the global cap and refunds the user's reservation", async () => {
    const store = new MemoryQuotaStore();
    store.rows.set(`YOUTUBE_UNITS|${GLOBAL_SUBJECT}|2026-10-15`, 9_000);
    await expect(reserveQuota(store, { scope: "YOUTUBE_UNITS", userId: "u1", units: 1, caps, now })).rejects.toMatchObject({
      code: "QUOTA_EXHAUSTED",
    });
    expect(await store.used("YOUTUBE_UNITS", "u1", "2026-10-15")).toBe(0);
  });

  it("release gives units back to both the user and the global counter", async () => {
    const store = new MemoryQuotaStore();
    const reservation = await reserveQuota(store, { scope: "YOUTUBE_UNITS", userId: "u1", units: 5, caps, now });
    await reservation.release();
    await reservation.release(); // idempotent
    expect(await store.used("YOUTUBE_UNITS", "u1", "2026-10-15")).toBe(0);
    expect(await store.used("YOUTUBE_UNITS", GLOBAL_SUBJECT, "2026-10-15")).toBe(0);
  });

  it("concurrent reservations never overshoot the cap", async () => {
    const store = new MemoryQuotaStore();
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        reserveQuota(store, { scope: "EMAILS", userId: "u1", units: 1, caps: { user: 10, global: null }, now }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10);
    expect(await store.used("EMAILS", "u1", "2026-10-16")).toBe(10);
  });
});
