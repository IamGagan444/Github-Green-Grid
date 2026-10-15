import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { hmacSha256Hex } from "@/lib/encryption";
import { AppError } from "@/lib/errors";
import {
  NOT_FOLLOWING_TEXT,
  PRIVATE_REPLY_WINDOW_MS,
  processInstagramEvent,
  type AutomationContent,
  type ClaimedEvent,
  type InstagramEventStore,
  type InstagramPort,
} from "@/lib/instagram/engine";
import { graphErrorToAppError } from "@/lib/instagram/errors";
import { keywordMatches, matchAutomation, type MatchableAutomation } from "@/lib/instagram/matcher";
import {
  buildFirstMessage,
  followGatePayload,
  parseFollowGatePayload,
  pickPublicReply,
} from "@/lib/instagram/message";
import { parseSignedRequest, verifyMetaSignature } from "@/lib/instagram/signature";
import type { InboundEvent, OutgoingMessage } from "@/lib/instagram/types";
import { normaliseWebhook, webhookEnvelopeSchema } from "@/lib/instagram/webhook";
import { instagramAutomationSchema } from "@/validators/instagram";

const IG = "17841400000000001";
const EVENT_ID = "cmevent00000000000001";

// ─────────────────────────────────────────────────────────────────────────────
// Signatures
// ─────────────────────────────────────────────────────────────────────────────

describe("webhook signature", () => {
  const body = JSON.stringify({ object: "instagram", entry: [] });

  it("accepts Meta's sha256 signature over the raw body", () => {
    const signature = `sha256=${hmacSha256Hex("secret", body)}`;
    expect(verifyMetaSignature({ appSecret: "secret", signature, rawBody: body })).toBe(true);
  });

  it("rejects missing, malformed or wrong signatures", () => {
    expect(verifyMetaSignature({ appSecret: "secret", signature: null, rawBody: body })).toBe(false);
    expect(verifyMetaSignature({ appSecret: "secret", signature: "sha1=abc", rawBody: body })).toBe(false);
    const wrong = `sha256=${hmacSha256Hex("other", body)}`;
    expect(verifyMetaSignature({ appSecret: "secret", signature: wrong, rawBody: body })).toBe(false);
    const tampered = `sha256=${hmacSha256Hex("secret", body)}`;
    expect(verifyMetaSignature({ appSecret: "secret", signature: tampered, rawBody: `${body} ` })).toBe(false);
  });

  it("verifies signed_request payloads", () => {
    const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "123" })).toString("base64url");
    const sig = crypto.createHmac("sha256", "secret").update(payload).digest("base64url");
    expect(parseSignedRequest(`${sig}.${payload}`, "secret")).toMatchObject({ user_id: "123" });
    expect(parseSignedRequest(`${sig}.${payload}`, "other")).toBeNull();
    expect(parseSignedRequest("garbage", "secret")).toBeNull();
    expect(parseSignedRequest(null, "secret")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhook parsing
// ─────────────────────────────────────────────────────────────────────────────

function parse(body: unknown) {
  return normaliseWebhook(webhookEnvelopeSchema.parse(body));
}

describe("webhook normalisation", () => {
  it("parses a reel comment", () => {
    const events = parse({
      object: "instagram",
      entry: [
        {
          id: IG,
          time: 1_760_000_000,
          changes: [
            {
              field: "comments",
              value: {
                id: "c1",
                text: "LINK please",
                from: { id: "u1", username: "fan" },
                media: { id: "m1", media_product_type: "REELS" },
              },
            },
          ],
        },
      ],
    });
    expect(events).toEqual([
      {
        kind: "COMMENT",
        igUserId: IG,
        commentId: "c1",
        senderIgsid: "u1",
        senderUsername: "fan",
        mediaId: "m1",
        mediaProductType: "REELS",
        text: "LINK please",
        occurredAt: new Date(1_760_000_000_000),
      },
    ]);
  });

  it("ignores the account's own comments (our public replies)", () => {
    const events = parse({
      object: "instagram",
      entry: [{ id: IG, time: 1, changes: [{ field: "comments", value: { id: "c2", text: "Sent!", from: { id: IG } } }] }],
    });
    expect(events).toEqual([]);
  });

  it("classifies DMs, story replies, story mentions, postbacks and quick replies; drops echoes", () => {
    const messaging = [
      { sender: { id: "u1" }, recipient: { id: IG }, timestamp: 1_760_000_000_000, message: { mid: "a", text: "guide" } },
      {
        sender: { id: "u1" },
        recipient: { id: IG },
        timestamp: 1,
        message: { mid: "b", text: "🔥", reply_to: { story: { id: "s1", url: "https://x" } } },
      },
      {
        sender: { id: "u1" },
        recipient: { id: IG },
        timestamp: 1,
        message: { mid: "c", attachments: [{ type: "story_mention", payload: { url: "https://x" } }] },
      },
      { sender: { id: "u1" }, recipient: { id: IG }, timestamp: 1, postback: { mid: "d", payload: "GG_FOLLOW:x" } },
      {
        sender: { id: "u1" },
        recipient: { id: IG },
        timestamp: 1,
        message: { mid: "e", text: "Yes", quick_reply: { payload: "QR" } },
      },
      { sender: { id: IG }, recipient: { id: "u1" }, timestamp: 1, message: { mid: "f", text: "hi", is_echo: true } },
    ];
    const kinds = parse({ object: "instagram", entry: [{ id: IG, time: 1, messaging }] }).map((event) => event.kind);
    expect(kinds).toEqual(["MESSAGE", "STORY_REPLY", "STORY_MENTION", "POSTBACK", "POSTBACK"]);
  });

  it("skips malformed items without failing the delivery", () => {
    const events = parse({
      object: "instagram",
      entry: [{ id: IG, time: 1, changes: [{ field: "comments", value: { nope: true } }], messaging: [{ junk: 1 }] }],
    });
    expect(events).toEqual([]);
  });

  it("ignores non-instagram objects", () => {
    expect(parse({ object: "page", entry: [] })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

describe("keyword matching", () => {
  it("matches whole words, ignoring case, accents and punctuation", () => {
    expect(keywordMatches("LINK!!", ["link"], "CONTAINS")).toBe(true);
    expect(keywordMatches("send me the línk pls", ["link"], "CONTAINS")).toBe(true);
    expect(keywordMatches("I linked it", ["link"], "CONTAINS")).toBe(false);
    expect(keywordMatches("free guide please", ["free guide"], "CONTAINS")).toBe(true);
  });

  it("supports exact and any modes", () => {
    expect(keywordMatches("Link!", ["link"], "EXACT")).toBe(true);
    expect(keywordMatches("link please", ["link"], "EXACT")).toBe(false);
    expect(keywordMatches(null, [], "ANY")).toBe(true);
    expect(keywordMatches(null, ["link"], "CONTAINS")).toBe(false);
  });
});

function automation(overrides: Partial<MatchableAutomation>): MatchableAutomation {
  return {
    id: "a",
    trigger: "COMMENT",
    mediaIds: [],
    keywords: ["link"],
    matchMode: "CONTAINS",
    createdAt: new Date(0),
    ...overrides,
  };
}

const comment: InboundEvent = {
  kind: "COMMENT",
  igUserId: IG,
  commentId: "c1",
  senderIgsid: "u1",
  senderUsername: "fan",
  mediaId: "m1",
  mediaProductType: "REELS",
  text: "link",
  occurredAt: new Date(),
};

describe("automation selection", () => {
  it("prefers a post-specific automation over an account-wide one", () => {
    const pick = matchAutomation(comment, [
      automation({ id: "any-post" }),
      automation({ id: "this-reel", mediaIds: ["m1"], createdAt: new Date(5) }),
    ]);
    expect(pick?.id).toBe("this-reel");
  });

  it("does not fire on other posts or other triggers", () => {
    expect(matchAutomation(comment, [automation({ mediaIds: ["m2"] })])).toBeNull();
    expect(matchAutomation(comment, [automation({ trigger: "DM_KEYWORD" })])).toBeNull();
  });

  it("fires story mentions regardless of text", () => {
    const mention: InboundEvent = { kind: "STORY_MENTION", igUserId: IG, mid: "m", senderIgsid: "u", text: null, occurredAt: new Date() };
    expect(matchAutomation(mention, [automation({ trigger: "STORY_MENTION", keywords: [] })])?.id).toBe("a");
  });

  it("never matches postbacks", () => {
    const postback: InboundEvent = { kind: "POSTBACK", igUserId: IG, mid: "m", senderIgsid: "u", payload: "x", occurredAt: new Date() };
    expect(matchAutomation(postback, [automation({})])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────────

const content: AutomationContent = {
  id: "auto1",
  active: true,
  publicReplyEnabled: true,
  publicReplies: ["Sent! Check your DMs"],
  dmMessage: "Here you go",
  linkUrl: "https://example.com/guide",
  linkButtonLabel: "Get the guide",
  followGateEnabled: false,
  followGateMessage: "Follow first",
  followButtonLabel: "I'm following",
};

describe("message building", () => {
  it("sends the link as a URL button", () => {
    expect(buildFirstMessage(content, EVENT_ID, "https://gg/r/ig/x")).toEqual({
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Here you go",
          buttons: [{ type: "web_url", url: "https://gg/r/ig/x", title: "Get the guide" }],
        },
      },
    });
  });

  it("sends plain text when there is no link", () => {
    expect(buildFirstMessage({ ...content, linkUrl: null }, EVENT_ID, null)).toEqual({ text: "Here you go" });
  });

  it("sends a postback button for the follow-gate", () => {
    const message = buildFirstMessage({ ...content, followGateEnabled: true }, EVENT_ID, "https://gg/r/ig/x");
    expect(message).toMatchObject({
      attachment: { payload: { text: "Follow first", buttons: [{ type: "postback", payload: followGatePayload(EVENT_ID) }] } },
    });
  });

  it("round-trips follow-gate payloads and rejects foreign ones", () => {
    expect(parseFollowGatePayload(followGatePayload(EVENT_ID))).toBe(EVENT_ID);
    expect(parseFollowGatePayload("SOMETHING_ELSE")).toBeNull();
    expect(parseFollowGatePayload("GG_FOLLOW:../../etc")).toBeNull();
  });

  it("picks a public reply variant and skips blanks", () => {
    expect(pickPublicReply(["a", " ", "b"], () => 0.99)).toBe("b");
    expect(pickPublicReply(["  "])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

function harness(event: Partial<ClaimedEvent>, options: { follows?: boolean; failPrivateReply?: AppError[] } = {}) {
  const row: ClaimedEvent = {
    id: EVENT_ID,
    type: "COMMENT",
    sourceId: "c1",
    senderIgsid: "u1",
    text: "link",
    occurredAt: new Date("2026-10-15T10:00:00Z"),
    attempt: 1,
    publicReplyStatus: "PENDING",
    dmStatus: "PENDING",
    linkStatus: "PENDING",
    automation: content,
    ...event,
  };
  const calls: Array<{ op: string; target: string; message?: OutgoingMessage | string }> = [];
  const state = { status: "RUNNING" as string, retryAt: null as Date | null, sent: 0, linkDelivered: [] as string[], claimed: false };
  const failures = [...(options.failPrivateReply ?? [])];

  const store: InstagramEventStore = {
    async claim() {
      if (state.claimed || state.status !== "RUNNING") return null;
      state.claimed = true;
      return { ...row };
    },
    async saveStep(_id, patch) {
      Object.assign(row, patch);
    },
    async finish(_id, status) {
      state.status = status;
    },
    async scheduleRetry(_id, at) {
      state.retryAt = at;
      state.claimed = false;
      row.attempt += 1;
    },
    async markLinkDelivered(origin) {
      state.linkDelivered.push(origin);
    },
    async incrementSent() {
      state.sent += 1;
    },
  };
  const port: InstagramPort = {
    async privateReply(commentId, message) {
      const failure = failures.shift();
      if (failure) throw failure;
      calls.push({ op: "privateReply", target: commentId, message });
      return { messageId: "mid1" };
    },
    async sendDirect(igsid, message) {
      calls.push({ op: "sendDirect", target: igsid, message });
      return { messageId: "mid2" };
    },
    async replyToComment(commentId, text) {
      calls.push({ op: "replyToComment", target: commentId, message: text });
      return { id: "reply1" };
    },
    async followsBusiness() {
      return options.follows ?? false;
    },
  };
  const deps = {
    store,
    port,
    trackedUrl: (origin: string, link: string | null) => (link ? `https://gg/r/ig/${origin}` : null),
    now: () => new Date("2026-10-15T10:05:00Z"),
    random: () => 0,
  };
  return { deps, calls, state, row };
}

describe("instagram engine", () => {
  it("DMs the commenter, then replies publicly", async () => {
    const { deps, calls, state, row } = harness({});
    expect(await processInstagramEvent(deps, EVENT_ID)).toBe("SUCCESS");
    expect(calls.map((call) => call.op)).toEqual(["privateReply", "replyToComment"]);
    expect(calls[0]?.target).toBe("c1");
    expect(row).toMatchObject({ dmStatus: "SUCCESS", publicReplyStatus: "SUCCESS", linkStatus: "SUCCESS" });
    expect(state.sent).toBe(1);
  });

  it("never sends twice when a claim is already held or finished", async () => {
    const { deps, calls } = harness({});
    await processInstagramEvent(deps, EVENT_ID);
    expect(await processInstagramEvent(deps, EVENT_ID)).toBe("BUSY");
    expect(calls.filter((call) => call.op === "privateReply")).toHaveLength(1);
  });

  it("resumes after a transient failure without resending the DM", async () => {
    const { deps, calls, state } = harness({ dmStatus: "SUCCESS", linkStatus: "SUCCESS" });
    expect(await processInstagramEvent(deps, EVENT_ID)).toBe("SUCCESS");
    expect(calls.map((call) => call.op)).toEqual(["replyToComment"]);
    expect(state.sent).toBe(0);
  });

  it("schedules a retry on rate limits and fails permanently on rejections", async () => {
    const limited = harness({}, { failPrivateReply: [new AppError("INSTAGRAM_RATE_LIMITED", "x", { retryAfterMs: 120_000 })] });
    expect(await processInstagramEvent(limited.deps, EVENT_ID)).toBe("RETRY");
    expect(limited.state.retryAt?.toISOString()).toBe("2026-10-15T10:07:00.000Z");

    const rejected = harness(
      { automation: { ...content, linkUrl: null } },
      { failPrivateReply: [new AppError("INSTAGRAM_REQUEST_REJECTED", "x")] },
    );
    expect(await processInstagramEvent(rejected.deps, EVENT_ID)).toBe("FAILED");
  });

  it("falls back to a plain-text private reply when the template is refused", async () => {
    const { deps, calls } = harness({}, { failPrivateReply: [new AppError("INSTAGRAM_REQUEST_REJECTED", "x")] });
    expect(await processInstagramEvent(deps, EVENT_ID)).toBe("SUCCESS");
    expect(calls[0]?.message).toEqual({ text: `Here you go\n\nhttps://gg/r/ig/${EVENT_ID}` });
  });

  it("skips comments older than the 7-day private reply window", async () => {
    const old = new Date(new Date("2026-10-15T10:05:00Z").getTime() - PRIVATE_REPLY_WINDOW_MS - 1000);
    const { deps, calls, state } = harness({ occurredAt: old });
    expect(await processInstagramEvent(deps, EVENT_ID)).toBe("SKIPPED");
    expect(calls).toEqual([]);
    expect(state.status).toBe("SKIPPED");
  });

  it("skips events whose automation was paused or deleted", async () => {
    const paused = harness({ automation: { ...content, active: false } });
    expect(await processInstagramEvent(paused.deps, EVENT_ID)).toBe("SKIPPED");
    const deleted = harness({ automation: null });
    expect(await processInstagramEvent(deleted.deps, EVENT_ID)).toBe("SKIPPED");
  });

  it("answers DM keywords directly in the conversation", async () => {
    const { deps, calls } = harness({ type: "MESSAGE", sourceId: "mid" });
    expect(await processInstagramEvent(deps, EVENT_ID)).toBe("SUCCESS");
    expect(calls).toEqual([expect.objectContaining({ op: "sendDirect", target: "u1" })]);
  });

  describe("follow-gate", () => {
    const gated = { ...content, followGateEnabled: true };
    const postback = (follows: boolean) =>
      harness({ id: "cmpostback0000000001", type: "POSTBACK", text: followGatePayload(EVENT_ID), automation: gated }, { follows });

    it("first DM asks to follow and holds back the link", async () => {
      const { deps, calls, row } = harness({ automation: gated });
      await processInstagramEvent(deps, EVENT_ID);
      expect(JSON.stringify(calls[0]?.message)).toContain("postback");
      expect(JSON.stringify(calls[0]?.message)).not.toContain("example.com");
      expect(row.linkStatus).toBe("PENDING");
    });

    it("sends the link once the person follows", async () => {
      const { deps, calls, state } = postback(true);
      expect(await processInstagramEvent(deps, "cmpostback0000000001")).toBe("SUCCESS");
      expect(JSON.stringify(calls[0]?.message)).toContain(`https://gg/r/ig/${EVENT_ID}`);
      expect(state.linkDelivered).toEqual([EVENT_ID]);
    });

    it("re-prompts when they do not follow yet", async () => {
      const { deps, calls, state } = postback(false);
      await processInstagramEvent(deps, "cmpostback0000000001");
      expect(JSON.stringify(calls[0]?.message)).toContain(NOT_FOLLOWING_TEXT);
      expect(state.linkDelivered).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Errors & validation
// ─────────────────────────────────────────────────────────────────────────────

describe("graph error mapping", () => {
  it("classifies revoked, throttled, permission, window and server errors", () => {
    expect(graphErrorToAppError({ code: 190 }, "x", 400).code).toBe("INSTAGRAM_TOKEN_REVOKED");
    expect(graphErrorToAppError({ code: 4 }, "x", 400).retryable).toBe(true);
    expect(graphErrorToAppError(undefined, "x", 429).code).toBe("INSTAGRAM_RATE_LIMITED");
    expect(graphErrorToAppError({ code: 10 }, "x", 403).code).toBe("INSTAGRAM_PERMISSION_DENIED");
    expect(graphErrorToAppError({ code: 10, error_subcode: 2534022 }, "x", 400).code).toBe("INSTAGRAM_REQUEST_REJECTED");
    expect(graphErrorToAppError({ code: 2 }, "x", 500).code).toBe("INSTAGRAM_UNAVAILABLE");
    expect(graphErrorToAppError({ code: 100 }, "x", 400).retryable).toBe(false);
  });
});

describe("automation validation", () => {
  const base = {
    integrationId: "int1",
    name: "Reel guide",
    trigger: "COMMENT",
    keywords: ["LINK", "link "],
    dmMessage: "Here you go",
    linkUrl: "https://example.com",
  };

  it("normalises keywords and applies defaults", () => {
    const parsed = instagramAutomationSchema.parse(base);
    expect(parsed.keywords).toEqual(["link"]);
    expect(parsed.matchMode).toBe("CONTAINS");
    expect(parsed.followGateEnabled).toBe(false);
  });

  it("rejects inconsistent configurations", () => {
    expect(instagramAutomationSchema.safeParse({ ...base, keywords: [] }).success).toBe(false);
    expect(instagramAutomationSchema.safeParse({ ...base, linkUrl: "http://example.com" }).success).toBe(false);
    expect(instagramAutomationSchema.safeParse({ ...base, linkUrl: null, followGateEnabled: true }).success).toBe(false);
    expect(instagramAutomationSchema.safeParse({ ...base, trigger: "DM_KEYWORD", mediaIds: ["123"] }).success).toBe(false);
    expect(instagramAutomationSchema.safeParse({ ...base, publicReplyEnabled: true }).success).toBe(false);
    expect(instagramAutomationSchema.safeParse({ ...base, trigger: "STORY_MENTION", keywords: [] }).success).toBe(true);
  });
});
