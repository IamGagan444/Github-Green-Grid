import { describe, expect, it } from "vitest";

import { gcraWaitMs } from "@/lib/rate-limit";

describe("GCRA token bucket", () => {
  it("allows a burst, then spaces requests at the sustained rate", () => {
    const store = new Map<string, number>();
    const options = { ratePerSecond: 1, burst: 3 };
    const t0 = 1_000_000;
    expect(gcraWaitMs(store, "chat", options, t0)).toBe(0);
    expect(gcraWaitMs(store, "chat", options, t0)).toBe(0);
    expect(gcraWaitMs(store, "chat", options, t0)).toBe(0);
    // Fourth message in the same instant must wait one interval.
    expect(gcraWaitMs(store, "chat", options, t0)).toBe(1_000);
    expect(gcraWaitMs(store, "chat", options, t0 + 1_000)).toBe(0);
  });

  it("keeps a global ~25 msg/s budget", () => {
    const store = new Map<string, number>();
    const options = { ratePerSecond: 25, burst: 25 };
    const t0 = 5_000_000;
    let allowed = 0;
    for (let i = 0; i < 100; i += 1) if (gcraWaitMs(store, "global", options, t0) === 0) allowed += 1;
    expect(allowed).toBe(25);
  });

  it("buckets are independent per key", () => {
    const store = new Map<string, number>();
    const options = { ratePerSecond: 1, burst: 1 };
    expect(gcraWaitMs(store, "a", options, 0)).toBe(0);
    expect(gcraWaitMs(store, "b", options, 0)).toBe(0);
    expect(gcraWaitMs(store, "a", options, 0)).toBeGreaterThan(0);
  });
});
