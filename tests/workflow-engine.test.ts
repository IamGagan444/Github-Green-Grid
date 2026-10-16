import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { interleaveByUser, LEASE_MS, MAX_ATTEMPTS, processRun, retryDelayMs } from "@/lib/workflow/engine";
import { NotPerformedError, type StepHandler } from "@/lib/workflow/types";
import { engineDeps, fakeClock, MemoryRunStore } from "./helpers/workflow-fakes";

const ok = (externalId = "msg-1"): StepHandler => ({ run: vi.fn(async () => ({ externalId })) });
const failing = (error: AppError | Error): StepHandler => ({
  run: vi.fn(async () => {
    throw error;
  }),
});

describe("workflow engine: claiming", () => {
  it("runs every step once and finishes SUCCESS", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "notify:a" }, { key: "notify:b" }] });
    const a = ok("a-1");
    const b = ok("b-1");

    expect(await processRun(engineDeps(store, { "notify:a": a, "notify:b": b }, fakeClock()), "r1")).toBe("SUCCESS");
    expect(store.runs.get("r1")?.status).toBe("SUCCESS");
    expect(store.step("r1", "notify:a").externalId).toBe("a-1");
    expect(a.run).toHaveBeenCalledTimes(1);
  });

  it("a second worker cannot claim a leased run", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "notify:a" }] });
    const clock = fakeClock();
    await store.claim("r1", LEASE_MS, clock.now());

    const handler = ok();
    expect(await processRun(engineDeps(store, { "notify:a": handler }, clock), "r1")).toBe("BUSY");
    expect(handler.run).not.toHaveBeenCalled();

    // Once the lease expires (worker died), the run is taken over.
    clock.advance(LEASE_MS + 1);
    expect(await processRun(engineDeps(store, { "notify:a": handler }, clock), "r1")).toBe("SUCCESS");
  });

  it("finished runs are never processed again", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "notify:a" }] });
    const handler = ok();
    const clock = fakeClock();
    await processRun(engineDeps(store, { "notify:a": handler }, clock), "r1");
    expect(await processRun(engineDeps(store, { "notify:a": handler }, clock), "r1")).toBe("BUSY");
    expect(handler.run).toHaveBeenCalledTimes(1);
  });
});

describe("workflow engine: retries", () => {
  it("retries transient failures with backoff and never re-sends delivered steps", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "notify:a" }, { key: "notify:b" }] });
    const clock = fakeClock();
    const a = ok();
    let calls = 0;
    const b: StepHandler = {
      run: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new AppError("CHANNEL_DELIVERY_FAILED", "502");
        return { externalId: "b-2" };
      }),
    };
    const deps = engineDeps(store, { "notify:a": a, "notify:b": b }, clock);

    expect(await processRun(deps, "r1")).toBe("RETRY");
    expect(store.runs.get("r1")?.nextRetryAt?.getTime()).toBe(clock.now().getTime() + retryDelayMs(1));
    expect(store.step("r1", "notify:a").status).toBe("SUCCESS");
    expect(store.step("r1", "notify:b").status).toBe("PENDING");

    // Not due yet.
    expect(await processRun(deps, "r1")).toBe("BUSY");

    clock.advance(retryDelayMs(1));
    expect(await processRun(deps, "r1")).toBe("SUCCESS");
    expect(a.run).toHaveBeenCalledTimes(1);
    expect(b.run).toHaveBeenCalledTimes(2);
  });

  it("honours a provider's retry-after when longer than the backoff", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "notify:a" }] });
    const clock = fakeClock();
    const handler = failing(new AppError("CHANNEL_RATE_LIMITED", "429", { retryAfterMs: 30 * 60_000 }));
    await processRun(engineDeps(store, { "notify:a": handler }, clock), "r1");
    expect(store.runs.get("r1")?.nextRetryAt?.getTime()).toBe(clock.now().getTime() + 30 * 60_000);
  });

  it("gives up after MAX_ATTEMPTS and reports the failure once", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "notify:a" }] });
    const clock = fakeClock();
    const permanent = vi.fn(async () => undefined);
    const deps = engineDeps(store, { "notify:a": failing(new AppError("CHANNEL_DELIVERY_FAILED", "5xx")) }, clock, permanent);

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(await processRun(deps, "r1")).toBe("RETRY");
      clock.advance(2 * 60 * 60_000);
    }
    expect(await processRun(deps, "r1")).toBe("FAILED");
    expect(store.step("r1", "notify:a").status).toBe("FAILED");
    expect(permanent).toHaveBeenCalledTimes(1);
  });

  it("permanent failures are not retried, but other channels still deliver", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "notify:a" }, { key: "notify:b" }] });
    const permanent = vi.fn(async () => undefined);
    const b = ok();
    const deps = engineDeps(store, { "notify:a": failing(new AppError("CHANNEL_UNAVAILABLE", "403 blocked")), "notify:b": b }, fakeClock(), permanent);

    expect(await processRun(deps, "r1")).toBe("FAILED");
    expect(store.step("r1", "notify:a").status).toBe("FAILED");
    expect(store.step("r1", "notify:b").status).toBe("SUCCESS");
    expect(permanent).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), expect.objectContaining({ key: "notify:a" }), expect.any(AppError));
  });

  it("a failing blocking step skips the steps that depend on it", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "ai.draft" }, { key: "publish" }] });
    const publish = ok();
    const deps = engineDeps(
      store,
      { "ai.draft": { blocking: true, run: failing(new AppError("INTERNAL", "boom")).run }, publish },
      fakeClock(),
    );
    expect(await processRun(deps, "r1")).toBe("FAILED");
    expect(publish.run).not.toHaveBeenCalled();
    expect(store.step("r1", "publish").status).toBe("SKIPPED");
  });

  it("quota waits do not consume the retry budget", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "notify:a" }] });
    const clock = fakeClock();
    const deps = engineDeps(
      store,
      { "notify:a": failing(new AppError("QUOTA_EXHAUSTED", "cap", { retryAfterMs: 3 * 60 * 60_000 })) },
      clock,
    );
    expect(await processRun(deps, "r1")).toBe("RETRY");
    expect(store.runs.get("r1")?.attempt).toBe(0);
    expect(store.runs.get("r1")?.nextRetryAt?.getTime()).toBe(clock.now().getTime() + 3 * 60 * 60_000);
  });

  it("finishes SKIPPED when nothing was delivered", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "notify:a" }] });
    const deps = engineDeps(store, { "notify:a": { run: async () => ({ status: "SKIPPED" }) } }, fakeClock());
    expect(await processRun(deps, "r1")).toBe("SKIPPED");
  });
});

describe("workflow engine: at-most-once steps (LinkedIn posts)", () => {
  it("is never retried after a 2xx, even if saving the result crashed", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "publish:linkedin", semantics: "AT_MOST_ONCE" }] });
    const clock = fakeClock();
    const post = ok("urn:li:share:1");
    const deps = engineDeps(store, { "publish:linkedin": post }, clock);

    // The provider accepted the post, then the worker crashed before recording it.
    store.failNextComplete = true;
    await expect(processRun(deps, "r1")).rejects.toThrow("simulated crash");
    expect(store.step("r1", "publish:linkedin").status).toBe("IN_FLIGHT");

    clock.advance(LEASE_MS + 1);
    expect(await processRun(deps, "r1")).toBe("FAILED");
    expect(store.step("r1", "publish:linkedin").status).toBe("UNKNOWN");
    expect(post.run).toHaveBeenCalledTimes(1);

    // And it stays that way on every later claim.
    expect(await processRun(deps, "r1")).toBe("BUSY");
    expect(post.run).toHaveBeenCalledTimes(1);
  });

  it("an ambiguous failure (timeout, 5xx) becomes UNKNOWN, not a retry", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "publish:linkedin", semantics: "AT_MOST_ONCE" }] });
    const deps = engineDeps(store, { "publish:linkedin": failing(new AppError("CHANNEL_DELIVERY_FAILED", "timeout")) }, fakeClock());
    expect(await processRun(deps, "r1")).toBe("FAILED");
    expect(store.step("r1", "publish:linkedin").status).toBe("UNKNOWN");
  });

  it("is retried only when the handler proves nothing was sent", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "publish:linkedin", semantics: "AT_MOST_ONCE" }] });
    const deps = engineDeps(
      store,
      { "publish:linkedin": failing(new NotPerformedError(new AppError("CHANNEL_RATE_LIMITED", "429"))) },
      fakeClock(),
    );
    expect(await processRun(deps, "r1")).toBe("RETRY");
    expect(store.step("r1", "publish:linkedin").status).toBe("PENDING");
  });

  it("at-least-once steps left in flight are simply retried", async () => {
    const store = new MemoryRunStore();
    store.add({ id: "r1", steps: [{ key: "notify:a", status: "IN_FLIGHT" }] });
    const handler = ok();
    expect(await processRun(engineDeps(store, { "notify:a": handler }, fakeClock()), "r1")).toBe("SUCCESS");
    expect(handler.run).toHaveBeenCalledTimes(1);
  });
});

describe("interleaveByUser", () => {
  it("serves users round-robin so one burst cannot starve others", () => {
    const items = [
      { id: "a1", userId: "a" },
      { id: "a2", userId: "a" },
      { id: "a3", userId: "a" },
      { id: "b1", userId: "b" },
      { id: "c1", userId: "c" },
    ];
    expect(interleaveByUser(items).map((item) => item.id)).toEqual(["a1", "b1", "c1", "a2", "a3"]);
  });
});
