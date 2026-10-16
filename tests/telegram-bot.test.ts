import { describe, expect, it, vi } from "vitest";

import {
  handleTelegramUpdate,
  isTelegramWebhookAuthorised,
  LINK_TOKEN_TTL_MS,
  parseCommand,
  telegramUpdateSchema,
  type TelegramBotDeps,
} from "@/lib/telegram/bot";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

/** Link tokens with the same rules as the database store: single use, 15-minute expiry. */
function harness(now = new Date("2026-10-16T10:00:00Z")) {
  const tokens = new Map([[TOKEN, { userId: "user-1", expiresAt: new Date(now.getTime() + LINK_TOKEN_TTL_MS), consumed: false }]]);
  const linked = new Map<string, string[]>();
  const replies: Array<{ chatId: string; html: string }> = [];
  let clock = now;

  const deps: TelegramBotDeps = {
    botUsername: "GreenGridBot",
    now: () => clock,
    consumeLinkToken: async (token, at) => {
      const row = tokens.get(token);
      if (!row || row.consumed || row.expiresAt <= at) return null;
      row.consumed = true;
      return row.userId;
    },
    linkChat: async (userId, chat) => {
      linked.set(String(chat.id), [...(linked.get(String(chat.id)) ?? []), userId]);
    },
    unlinkChat: async (chatId) => {
      const count = linked.get(chatId)?.length ?? 0;
      linked.delete(chatId);
      return count;
    },
    usersForChat: async (chatId) => linked.get(chatId) ?? [],
    requestDigest: vi.fn(async () => "queued" as const),
    handleCallback: vi.fn(async () => "Approved"),
    reply: async (chatId, html) => {
      replies.push({ chatId, html });
    },
    answerCallback: vi.fn(async () => undefined),
  };

  return {
    deps,
    linked,
    replies,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

const message = (text: string, chatId = 42) =>
  telegramUpdateSchema.parse({
    update_id: 1,
    message: { message_id: 1, chat: { id: chatId, type: "private", username: "alice" }, text },
  });

describe("telegram webhook secret", () => {
  it("accepts only the exact secret", () => {
    expect(isTelegramWebhookAuthorised("s3cret-value-123456", "s3cret-value-123456")).toBe(true);
    expect(isTelegramWebhookAuthorised("s3cret-value-123456", "s3cret-value-12345")).toBe(false);
    expect(isTelegramWebhookAuthorised("s3cret-value-123456", null)).toBe(false);
  });
});

describe("telegram commands", () => {
  it("parses commands, including the @bot suffix used in groups", () => {
    expect(parseCommand("/start abc", "GreenGridBot")).toEqual({ command: "start", argument: "abc" });
    expect(parseCommand("/digest@greengridbot", "GreenGridBot")).toEqual({ command: "digest", argument: "" });
    expect(parseCommand("/digest@OtherBot", "GreenGridBot")).toBeNull();
    expect(parseCommand("hello", "GreenGridBot")).toBeNull();
  });
});

describe("telegram link flow", () => {
  it("/start <token> binds the chat to the user", async () => {
    const { deps, linked, replies } = harness();
    await handleTelegramUpdate(deps, message(`/start ${TOKEN}`));
    expect(linked.get("42")).toEqual(["user-1"]);
    expect(replies.at(-1)?.html).toContain("Connected to GreenGrid");
  });

  it("tokens are single-use", async () => {
    const { deps, linked, replies } = harness();
    await handleTelegramUpdate(deps, message(`/start ${TOKEN}`));
    await handleTelegramUpdate(deps, message(`/start ${TOKEN}`, 99));
    expect(linked.has("99")).toBe(false);
    expect(replies.at(-1)?.html).toContain("expired or was already used");
  });

  it("tokens expire after 15 minutes", async () => {
    const { deps, linked, advance } = harness();
    advance(LINK_TOKEN_TTL_MS + 1);
    await handleTelegramUpdate(deps, message(`/start ${TOKEN}`));
    expect(linked.size).toBe(0);
  });

  it("malformed tokens never reach the store", async () => {
    const { deps } = harness();
    const consume = vi.spyOn(deps, "consumeLinkToken");
    await handleTelegramUpdate(deps, message("/start ../../etc"));
    expect(consume).not.toHaveBeenCalled();
  });

  it("/stop unlinks and /digest asks the digest automation", async () => {
    const { deps, linked, replies } = harness();
    await handleTelegramUpdate(deps, message(`/start ${TOKEN}`));
    await handleTelegramUpdate(deps, message("/digest"));
    expect(deps.requestDigest).toHaveBeenCalledWith("user-1");
    await handleTelegramUpdate(deps, message("/stop"));
    expect(linked.has("42")).toBe(false);
    expect(replies.at(-1)?.html).toContain("Disconnected");
  });

  it("/digest in an unlinked chat does nothing", async () => {
    const { deps, replies } = harness();
    await handleTelegramUpdate(deps, message("/digest"));
    expect(deps.requestDigest).not.toHaveBeenCalled();
    expect(replies.at(-1)?.html).toContain("not connected");
  });

  it("callback buttons only act for chats linked to a user", async () => {
    const { deps } = harness();
    const update = telegramUpdateSchema.parse({
      update_id: 2,
      callback_query: { id: "cb1", from: { id: 7 }, data: "cp:a:item1", message: { message_id: 3, chat: { id: 42, type: "private" } } },
    });
    await handleTelegramUpdate(deps, update);
    expect(deps.handleCallback).not.toHaveBeenCalled();
    expect(deps.answerCallback).toHaveBeenCalledWith("cb1", "This chat is not connected to GreenGrid.");
  });
});
