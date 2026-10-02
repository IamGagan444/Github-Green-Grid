import { describe, expect, it } from "vitest";

import { executeAutomation, MAX_ATTEMPTS } from "@/lib/automation/engine";
import { evaluateTakeover } from "@/lib/automation/takeover";
import { AppError } from "@/lib/errors";
import { UPDATE_EVENT_TYPE, HEADER_EVENT_TYPE } from "@/lib/slack/types";

import {
  automation,
  buildDeps,
  commit,
  FakeSlack,
  MemoryAnchorStore,
  MemoryExecutionStore,
  slotRequest,
} from "./helpers/engine-fakes";

const DATE = "2026-09-30";

function updates(slack: FakeSlack) {
  return slack.messages.filter((message) => message.metadata?.event_type === UPDATE_EVENT_TYPE);
}

function headers(slack: FakeSlack) {
  return slack.messages.filter((message) => message.metadata?.event_type === HEADER_EVENT_TYPE);
}

describe("execution idempotency", () => {
  it("posts a date header and one threaded reply on the happy path", async () => {
    const { deps, slack, store } = buildDeps();
    const outcome = await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });

    expect(outcome.status).toBe("SUCCESS");
    expect(headers(slack)).toHaveLength(1);
    expect(headers(slack)[0]?.text).toBe("📅 Wednesday, September 30, 2026");
    expect(updates(slack)).toHaveLength(1);
    expect(updates(slack)[0]?.thread_ts).toBe(headers(slack)[0]?.ts);

    const row = store.byKey(`auto_1:${DATE}:17:00`);
    expect(row?.status).toBe("SUCCESS");
    expect(row?.slackParentTs).toBe(headers(slack)[0]?.ts);
    expect(row?.slackReplyTs).toBe(updates(slack)[0]?.ts);
  });

  it("two concurrent executions of the same automation/date post exactly one update", async () => {
    const { deps, slack } = buildDeps();
    const request = { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" as const };

    const [first, second] = await Promise.all([executeAutomation(deps, request), executeAutomation(deps, request)]);

    expect([first.status, second.status].sort()).toEqual(["NOOP", "SUCCESS"]);
    expect(updates(slack)).toHaveLength(1);
    expect(headers(slack)).toHaveLength(1);
  });

  it("a second run after success is a no-op, for both the scheduler and Run now", async () => {
    const { deps, slack, calls } = buildDeps();
    const base = { automation: automation(), executionDate: DATE, ...slotRequest() };

    await executeAutomation(deps, { ...base, trigger: "SCHEDULED" });
    const again = await executeAutomation(deps, { ...base, trigger: "SCHEDULED" });
    const manual = await executeAutomation(deps, { ...base, trigger: "MANUAL" });

    expect(again).toMatchObject({ status: "NOOP", reason: "already_done" });
    expect(manual).toMatchObject({ status: "NOOP", reason: "already_done" });
    expect(updates(slack)).toHaveLength(1);
    expect(calls.github).toBe(1);
  });

  it("a crash between posting and saving does not duplicate the Slack update on resume", async () => {
    const store = new MemoryExecutionStore();
    const slack = new FakeSlack();
    let now = new Date("2026-09-30T11:30:00.000Z");
    const { deps } = buildDeps({ store, slack, now: () => now });

    store.failNextReplySave = true;
    const crashed = await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });
    // The database error is transient, so the run is scheduled for retry.
    expect(crashed).toMatchObject({ status: "FAILED", retryable: true });
    expect(updates(slack)).toHaveLength(1);

    now = new Date(now.getTime() + 60 * 60_000);
    const resumed = await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });

    expect(resumed).toMatchObject({ status: "SUCCESS", resumed: true });
    expect(updates(slack)).toHaveLength(1);
    expect(store.byKey(`auto_1:${DATE}:17:00`)?.slackReplyTs).toBe(updates(slack)[0]?.ts);
  });

  it("still detects the earlier post on resume when Slack returns no metadata", async () => {
    const store = new MemoryExecutionStore();
    const slack = new FakeSlack();
    slack.dropMetadata = true;
    let now = new Date("2026-09-30T11:30:00.000Z");
    const { deps } = buildDeps({ store, slack, now: () => now });

    store.failNextReplySave = true;
    await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });
    now = new Date(now.getTime() + 60 * 60_000);
    const resumed = await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });

    expect(resumed.status).toBe("SUCCESS");
    const replies = slack.messages.filter((message) => message.thread_ts);
    expect(replies).toHaveLength(1);
  });

  it("resumes with the stored AI output instead of regenerating a different message", async () => {
    const store = new MemoryExecutionStore();
    const slack = new FakeSlack();
    let now = new Date("2026-09-30T11:30:00.000Z");
    let aiCalls = 0;
    let slackDown = true;

    const { deps } = buildDeps({
      store,
      slack,
      now: () => now,
      summarize: async () => {
        aiCalls += 1;
        return { summary: { summary: [`Implemented feature variant ${aiCalls}`] }, model: "m" };
      },
    });
    const port = deps.slack;
    deps.slack = {
      ...port,
      prepareChannel: async (channel) => {
        if (slackDown) throw new AppError("SLACK_UNAVAILABLE", "503");
        return port.prepareChannel(channel);
      },
    };

    const first = await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });
    expect(first).toMatchObject({ status: "FAILED", code: "SLACK_UNAVAILABLE", retryable: true });

    slackDown = false;
    now = new Date(now.getTime() + 60 * 60_000);
    await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });

    expect(aiCalls).toBe(1);
    expect(updates(slack)[0]?.text).toContain("Implemented feature variant 1");
  });

  it("two automations posting to the same channel share one daily parent", async () => {
    const store = new MemoryExecutionStore();
    const anchors = new MemoryAnchorStore();
    const slack = new FakeSlack();
    const { deps } = buildDeps({ store, anchors, slack });

    await Promise.all([
      executeAutomation(deps, { automation: automation({ id: "auto_a", userId: "u_a" }), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" }),
      executeAutomation(deps, { automation: automation({ id: "auto_b", userId: "u_b" }), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" }),
    ]);

    expect(headers(slack)).toHaveLength(1);
    expect(updates(slack)).toHaveLength(2);
    expect(new Set(updates(slack).map((message) => message.thread_ts))).toEqual(new Set([headers(slack)[0]?.ts]));
  });

  it("reuses a matching date header that already exists in the channel", async () => {
    const slack = new FakeSlack();
    const manual = slack.post({ channel: "C1", text: ":date: Wednesday, September 30, 2026" });
    const { deps } = buildDeps({ slack });

    await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });

    expect(slack.topLevel("C1")).toHaveLength(1);
    expect(updates(slack)[0]?.thread_ts).toBe(manual.ts);
  });

  it("records SKIPPED without posting when there are no commits", async () => {
    const { deps, slack, store } = buildDeps({ commits: [] });
    const outcome = await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });

    expect(outcome).toMatchObject({ status: "SKIPPED", reason: "NO_COMMITS" });
    expect(slack.messages).toHaveLength(0);
    expect(store.byKey(`auto_1:${DATE}:17:00`)?.status).toBe("SKIPPED");
  });

  it("does not post when the AI output is invalid, and marks the run failed", async () => {
    const { deps, slack, store } = buildDeps({
      summarize: async () => {
        throw new AppError("AI_INVALID_OUTPUT", "bad json");
      },
    });
    const outcome = await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });

    expect(outcome).toMatchObject({ status: "FAILED", code: "AI_INVALID_OUTPUT" });
    expect(slack.messages).toHaveLength(0);
    expect(store.byKey(`auto_1:${DATE}:17:00`)).toMatchObject({ status: "FAILED", aiStatus: "FAILED", slackStatus: "SKIPPED" });
  });

  it("never schedules a retry for permanent failures", async () => {
    const { deps, store } = buildDeps({
      summarize: async () => {
        throw new AppError("AI_NOT_CONFIGURED");
      },
    });
    const outcome = await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });

    expect(outcome).toMatchObject({ status: "FAILED", retryable: false });
    expect(store.byKey(`auto_1:${DATE}:17:00`)?.nextRetryAt).toBeNull();
  });

  it("skips paused automations on scheduled runs", async () => {
    const { deps, slack } = buildDeps();
    const outcome = await executeAutomation(deps, {
      automation: automation({ status: "PAUSED" }),
      executionDate: DATE,
      ...slotRequest(),
      trigger: "SCHEDULED",
    });
    expect(outcome.status).toBe("SKIPPED");
    expect(slack.messages).toHaveLength(0);
  });

  it("posts a single top-level message in NO_THREAD mode", async () => {
    const { deps, slack } = buildDeps();
    await executeAutomation(deps, { automation: automation({ threadMode: "NO_THREAD" }), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });
    expect(headers(slack)).toHaveLength(0);
    expect(updates(slack)).toHaveLength(1);
    expect(updates(slack)[0]?.thread_ts).toBeUndefined();
  });

  it("uses the commit list it was given (sanity: engine passes commits to AI)", async () => {
    let seen = 0;
    const { deps } = buildDeps({
      commits: [commit(), commit({ message: "Fix race in scheduler" })],
      summarize: async ({ commits }) => {
        seen = commits.length;
        return { summary: { summary: ["Implemented token refresh"] }, model: "m" };
      },
    });
    await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...slotRequest(), trigger: "SCHEDULED" });
    expect(seen).toBe(2);
  });
});

describe("several posts a day", () => {
  const MORNING = slotRequest("10:00", { since: new Date("2026-09-29T18:30:00Z"), until: new Date("2026-09-30T04:30:00Z") });
  const EVENING = slotRequest("17:00", { since: new Date("2026-09-30T04:30:00Z"), until: new Date("2026-09-30T11:30:00Z") });

  it("posts once per time slot, all under one daily header", async () => {
    const { deps, slack } = buildDeps();
    const base = { automation: automation(), executionDate: DATE, trigger: "SCHEDULED" as const };

    expect((await executeAutomation(deps, { ...base, ...MORNING })).status).toBe("SUCCESS");
    expect((await executeAutomation(deps, { ...base, ...EVENING })).status).toBe("SUCCESS");
    // Re-running a slot is still a no-op.
    expect((await executeAutomation(deps, { ...base, ...MORNING })).status).toBe("NOOP");

    expect(headers(slack)).toHaveLength(1);
    expect(updates(slack)).toHaveLength(2);
    expect(new Set(updates(slack).map((message) => message.thread_ts))).toEqual(new Set([headers(slack)[0]?.ts]));
  });

  it("summarises each slot's own commit range, so posts never overlap", async () => {
    const { deps, calls } = buildDeps();
    const base = { automation: automation(), executionDate: DATE, trigger: "SCHEDULED" as const };

    await executeAutomation(deps, { ...base, ...MORNING });
    await executeAutomation(deps, { ...base, ...EVENING });

    expect(calls.windows).toEqual([
      { since: MORNING.window.since, until: MORNING.window.until },
      { since: EVENING.window.since, until: EVENING.window.until },
    ]);
  });

  it("a resumed run keeps the range stored when it was created", async () => {
    const store = new MemoryExecutionStore();
    let now = new Date("2026-09-30T11:30:00.000Z");
    let slackDown = true;
    const { deps, calls } = buildDeps({ store, now: () => now });
    const port = deps.slack;
    deps.slack = {
      ...port,
      prepareChannel: async (channel) => {
        if (slackDown) throw new AppError("SLACK_UNAVAILABLE", "503");
        return port.prepareChannel(channel);
      },
    };
    // AI output is not stored on failure here, so the resume fetches again.
    deps.store = {
      claim: (input) => store.claim(input),
      update: (id, patch) => store.update(id, { ...patch, aiOutput: undefined }),
    };

    await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...EVENING, trigger: "SCHEDULED" });
    slackDown = false;
    now = new Date(now.getTime() + 60 * 60_000);
    const widened = slotRequest("17:00", { since: new Date("2026-09-29T18:30:00Z"), until: EVENING.window.until });
    await executeAutomation(deps, { automation: automation(), executionDate: DATE, ...widened, trigger: "SCHEDULED" });

    expect(calls.windows).toHaveLength(2);
    expect(calls.windows[1]).toEqual({ since: EVENING.window.since, until: EVENING.window.until });
  });
});

describe("evaluateTakeover", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const base = { attempt: 1, leaseExpiresAt: null, nextRetryAt: null, slackReplyTs: null };

  it("treats success, or any posted reply, as terminal", () => {
    expect(evaluateTakeover({ ...base, status: "SUCCESS" }, "MANUAL", now, MAX_ATTEMPTS)).toBe("already_done");
    expect(evaluateTakeover({ ...base, status: "FAILED", slackReplyTs: "1.2" }, "MANUAL", now, MAX_ATTEMPTS)).toBe("already_done");
  });

  it("respects a live lease and resumes an expired one", () => {
    const live = new Date(now.getTime() + 60_000);
    const dead = new Date(now.getTime() - 60_000);
    expect(evaluateTakeover({ ...base, status: "RUNNING", leaseExpiresAt: live }, "SCHEDULED", now, 3)).toBe("in_progress");
    expect(evaluateTakeover({ ...base, status: "RUNNING", leaseExpiresAt: dead }, "SCHEDULED", now, 3)).toBe("takeover");
  });

  it("retries failed runs only when retryable, due, and under the attempt cap", () => {
    const due = new Date(now.getTime() - 1);
    const later = new Date(now.getTime() + 60_000);
    expect(evaluateTakeover({ ...base, status: "FAILED", nextRetryAt: due }, "SCHEDULED", now, 3)).toBe("takeover");
    expect(evaluateTakeover({ ...base, status: "FAILED", nextRetryAt: later }, "SCHEDULED", now, 3)).toBe("retry_not_due");
    expect(evaluateTakeover({ ...base, status: "FAILED" }, "SCHEDULED", now, 3)).toBe("not_retryable");
    expect(evaluateTakeover({ ...base, status: "FAILED", attempt: 3, nextRetryAt: due }, "SCHEDULED", now, 3)).toBe("not_retryable");
  });

  it("lets a person re-run a failed or skipped day, but not the scheduler", () => {
    expect(evaluateTakeover({ ...base, status: "FAILED" }, "MANUAL", now, 3)).toBe("takeover");
    expect(evaluateTakeover({ ...base, status: "SKIPPED" }, "MANUAL", now, 3)).toBe("takeover");
    expect(evaluateTakeover({ ...base, status: "SKIPPED" }, "SCHEDULED", now, 3)).toBe("already_done");
  });
});
