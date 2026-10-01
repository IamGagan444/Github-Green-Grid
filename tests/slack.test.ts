import { describe, expect, it } from "vitest";

import { slackErrorToAppError } from "@/lib/slack/errors";
import { buildDateHeader, buildUpdateMessage, escapeSlackText, formatLongDate } from "@/lib/slack/message";
import { verifySlackSignature } from "@/lib/slack/signature";
import { findDailyParent, findExistingUpdate, headerMetadata, normaliseHeaderText, updateMetadata } from "@/lib/slack/thread";
import { hmacSha256Hex } from "@/lib/encryption";

const HEADER = buildDateHeader("2026-09-30");

describe("message format", () => {
  it("renders the default header and update format", () => {
    expect(formatLongDate("2026-09-30")).toBe("Wednesday, September 30, 2026");
    expect(HEADER).toBe("📅 Wednesday, September 30, 2026");
    expect(buildUpdateMessage(["Implemented X", "Fixed Y"])).toBe("*Today's Update*\n\n✅ Implemented X\n✅ Fixed Y");
  });

  it("escapes Slack control characters in AI text", () => {
    expect(escapeSlackText("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
    const message = buildUpdateMessage(["Fixed <!here> & <@U1>"]);
    expect(message).not.toContain("<!here>");
    expect(message).toContain("&lt;!here&gt; &amp; &lt;@U1&gt;");
  });

  it("strips list markers and markdown the model adds", () => {
    expect(buildUpdateMessage(["- **Improved** `retry` logic"])).toBe("*Today's Update*\n\n✅ Improved retry logic");
  });

  it("falls back to the default header when the format lacks {date}", () => {
    expect(buildDateHeader("2026-09-30", "Standup")).toBe(HEADER);
  });
});

describe("daily parent detection", () => {
  const expected = { dateKey: "2026-09-30", anchorKey: `header:${HEADER}`, headerText: HEADER };

  it("prefers our own metadata-tagged header", () => {
    const parent = findDailyParent(
      [
        { ts: "100.1", text: "unrelated" },
        { ts: "101.1", text: "renamed header", metadata: headerMetadata("2026-09-30", `header:${HEADER}`) },
      ],
      expected,
    );
    expect(parent?.ts).toBe("101.1");
  });

  it("matches a header posted by someone else, whether emoji came back as unicode or shortcode", () => {
    expect(findDailyParent([{ ts: "5.1", text: ":date: Wednesday, September 30, 2026" }], expected)?.ts).toBe("5.1");
    expect(findDailyParent([{ ts: "6.1", text: "📅  Wednesday, September 30, 2026 " }], expected)?.ts).toBe("6.1");
  });

  it("ignores thread replies, system messages and other dates", () => {
    const parent = findDailyParent(
      [
        { ts: "7.1", thread_ts: "1.0", text: HEADER },
        { ts: "8.1", subtype: "channel_join", text: HEADER },
        { ts: "9.1", text: "📅 Tuesday, September 29, 2026" },
      ],
      expected,
    );
    expect(parent).toBeNull();
  });

  it("picks the earliest match so every automation converges on one thread", () => {
    const parent = findDailyParent(
      [
        { ts: "20.1", text: HEADER },
        { ts: "10.1", text: HEADER },
      ],
      expected,
    );
    expect(parent?.ts).toBe("10.1");
  });

  it("normalises header text", () => {
    expect(normaliseHeaderText(":calendar: A  &amp; B")).toBe("a & b");
  });
});

describe("existing update detection", () => {
  it("finds a reply carrying this execution's key", () => {
    const messages = [
      { ts: "1.1", text: "other", metadata: updateMetadata("auto_2:2026-09-30", "e2") },
      { ts: "2.1", text: "ours", metadata: updateMetadata("auto_1:2026-09-30", "e1") },
    ];
    expect(findExistingUpdate(messages, "auto_1:2026-09-30")?.ts).toBe("2.1");
    expect(findExistingUpdate(messages, "auto_1:2026-10-01")).toBeNull();
  });
});

describe("Slack error mapping", () => {
  it("classifies permanent and transient errors", () => {
    expect(slackErrorToAppError("token_revoked", "m")).toMatchObject({ code: "SLACK_TOKEN_REVOKED", retryable: false });
    expect(slackErrorToAppError("channel_not_found", "m")).toMatchObject({ code: "SLACK_CHANNEL_UNAVAILABLE", retryable: false });
    expect(slackErrorToAppError("missing_scope", "m")).toMatchObject({ code: "SLACK_PERMISSION_DENIED", retryable: false });
    expect(slackErrorToAppError("ratelimited", "m", 3000)).toMatchObject({ code: "SLACK_RATE_LIMITED", retryable: true, retryAfterMs: 3000 });
    expect(slackErrorToAppError("internal_error", "m")).toMatchObject({ retryable: true });
  });
});

describe("Slack request signatures", () => {
  const secret = "signing-secret";
  const body = '{"type":"url_verification","challenge":"x"}';
  const now = 1_790_000_000;
  const sign = (ts: number, payload = body) => `v0=${hmacSha256Hex(secret, `v0:${ts}:${payload}`)}`;

  it("accepts a valid, fresh signature", () => {
    expect(verifySlackSignature({ signingSecret: secret, timestamp: String(now), signature: sign(now), rawBody: body, nowSeconds: now })).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets and replays", () => {
    expect(verifySlackSignature({ signingSecret: secret, timestamp: String(now), signature: sign(now), rawBody: body + " ", nowSeconds: now })).toBe(false);
    expect(verifySlackSignature({ signingSecret: "other", timestamp: String(now), signature: sign(now), rawBody: body, nowSeconds: now })).toBe(false);
    expect(verifySlackSignature({ signingSecret: secret, timestamp: String(now - 600), signature: sign(now - 600), rawBody: body, nowSeconds: now })).toBe(false);
    expect(verifySlackSignature({ signingSecret: secret, timestamp: null, signature: null, rawBody: body, nowSeconds: now })).toBe(false);
  });
});

describe("test posts", () => {
  const testMetadata = { event_type: "greengrid_standup_test", event_payload: { kind: "test" } };
  const testParent = {
    ts: "1.000100",
    text: `🧪 *Test run* · preview only, not today's update\n${HEADER}`,
    metadata: testMetadata,
  };

  it("are never chosen as the daily parent", () => {
    expect(findDailyParent([testParent], { dateKey: "2026-09-30", anchorKey: `header:${HEADER}`, headerText: HEADER })).toBeNull();
  });

  it("are never mistaken for an already-posted update", () => {
    const update = buildUpdateMessage(["Implemented token refresh"]);
    const testReply = { ts: "1.000200", thread_ts: "1.000100", text: update, metadata: testMetadata };
    expect(findExistingUpdate([testParent], "auto_1:2026-09-30", update)).toBeNull();
    expect(findExistingUpdate([testReply], "auto_1:2026-09-30")).toBeNull();
  });
});
