import { describe, expect, it } from "vitest";

import { runWithBudget, selectDueAutomations } from "@/lib/scheduler/due";
import { backoffDelay, withRetry } from "@/lib/retry";
import { AppError } from "@/lib/errors";

const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;

describe("selectDueAutomations", () => {
  const automations = [
    { id: "ist_5pm", daysOfWeek: WEEKDAYS, scheduleTime: "17:00", timezone: "Asia/Kolkata" },
    { id: "ny_9am", daysOfWeek: WEEKDAYS, scheduleTime: "09:00", timezone: "America/New_York" },
    { id: "weekend", daysOfWeek: ["SATURDAY", "SUNDAY"] as const, scheduleTime: "17:00", timezone: "Asia/Kolkata" },
  ];

  it("selects only automations due in their own timezone and weekday", () => {
    // Wednesday 11:35Z = 17:05 IST, 07:35 in New York.
    const { due } = selectDueAutomations(automations, new Date("2026-09-30T11:35:00Z"));
    expect(due.map((item) => item.automationId)).toEqual(["ist_5pm"]);
    expect(due[0]?.executionDate).toBe("2026-09-30");
  });

  it("picks up New York later the same UTC day", () => {
    const { due } = selectDueAutomations(automations, new Date("2026-09-30T13:05:00Z"));
    expect(due.map((item) => item.automationId).sort()).toEqual(["ist_5pm", "ny_9am"]);
  });

  it("reports automations with an invalid timezone instead of throwing", () => {
    const { due, invalid } = selectDueAutomations(
      [...automations, { id: "broken", daysOfWeek: WEEKDAYS, scheduleTime: "17:00", timezone: "Nowhere/Land" }],
      new Date("2026-09-30T11:35:00Z"),
    );
    expect(invalid).toEqual(["broken"]);
    expect(due).toHaveLength(1);
  });
});

describe("runWithBudget", () => {
  it("runs everything with bounded concurrency", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await runWithBudget(
      [1, 2, 3, 4, 5, 6, 7],
      async (item) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        seen.push(item);
        active -= 1;
      },
      { concurrency: 3, deadline: Date.now() + 10_000 },
    );
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("defers work once the deadline passes", async () => {
    let clock = 0;
    const result = await runWithBudget(
      [1, 2, 3, 4],
      async () => {
        clock += 10;
      },
      { concurrency: 1, deadline: 15, now: () => clock },
    );
    expect(result).toEqual({ started: 2, deferred: 2 });
  });
});

describe("retry policy", () => {
  it("retries transient failures with backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new AppError("SLACK_UNAVAILABLE");
        return "ok";
      },
      { attempts: 3, sleep: async (ms) => void sleeps.push(ms), random: () => 1 },
    );
    expect(result).toBe("ok");
    expect(sleeps).toEqual([500, 1000]);
  });

  it("does not retry permanent failures", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new AppError("SLACK_TOKEN_REVOKED");
        },
        { attempts: 5, sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ code: "SLACK_TOKEN_REVOKED" });
    expect(calls).toBe(1);
  });

  it("honours a provider Retry-After hint", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new AppError("SLACK_RATE_LIMITED", "429", { retryAfterMs: 4000 });
        return true;
      },
      { sleep: async (ms) => void sleeps.push(ms), random: () => 0 },
    );
    expect(sleeps).toEqual([4000]);
  });

  it("caps the backoff", () => {
    expect(backoffDelay(10, 500, 8000, () => 1)).toBe(8000);
  });
});
