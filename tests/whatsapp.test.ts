import { describe, expect, it } from "vitest";

import { hubMessage } from "@/lib/hub/message";
import { renderWhatsApp } from "@/lib/hub/render";
import {
  extractLinkCode,
  generateLinkCode,
  handleWhatsAppMessage,
  inboundMessages,
  LINK_CODE_TTL_MS,
  maskPhone,
  waIdToE164,
  whatsAppChatLink,
  whatsAppWebhookSchema,
  type InboundMessage,
  type WhatsAppBotDeps,
} from "@/lib/whatsapp/bot";
import { whatsAppError } from "@/lib/whatsapp/errors";

const OWN_NUMBER_ID = "1234567890";
const CODE = "GG-7K2M9QXRTB";

/** Link codes with the same rules as the database store: single use, 15-minute expiry. */
function harness(now = new Date("2026-10-17T10:00:00Z")) {
  const codes = new Map([[CODE, { userId: "user-1", expiresAt: new Date(now.getTime() + LINK_CODE_TTL_MS), consumed: false }]]);
  const linked = new Map<string, string[]>();
  const replies: Array<{ phone: string; text: string }> = [];
  let clock = now;

  const deps: WhatsAppBotDeps = {
    now: () => clock,
    consumeLinkCode: async (code, at) => {
      const row = codes.get(code);
      if (!row || row.consumed || row.expiresAt <= at) return null;
      row.consumed = true;
      return row.userId;
    },
    linkPhone: async (userId, phone) => {
      linked.set(phone, [...(linked.get(phone) ?? []), userId]);
    },
    unlinkPhone: async (phone) => {
      const count = linked.get(phone)?.length ?? 0;
      linked.delete(phone);
      return count;
    },
    reply: async (phone, text) => {
      replies.push({ phone, text });
    },
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

const inbound = (text: string, phone = "+919876543210"): InboundMessage => ({ messageId: "wamid.1", phone, profileName: "Asha", text });

function webhook(overrides: { phoneNumberId?: string; message?: Record<string, unknown>; object?: string } = {}) {
  return whatsAppWebhookSchema.parse({
    object: overrides.object ?? "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: overrides.phoneNumberId ?? OWN_NUMBER_ID },
              contacts: [{ wa_id: "919876543210", profile: { name: " Asha " } }],
              messages: [overrides.message ?? { from: "919876543210", id: "wamid.1", type: "text", text: { body: `Link my GreenGrid account: ${CODE}` } }],
            },
          },
        ],
      },
    ],
  });
}

describe("link codes", () => {
  it("generates codes the extractor recognises", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateLinkCode();
      expect(code).toMatch(/^GG-[0-9A-HJKMNP-TV-Z]{10}$/);
      expect(extractLinkCode(`please link ${code} thanks`)).toBe(code);
    }
  });

  it("accepts lower case and a missing dash, but not look-alike letters", () => {
    expect(extractLinkCode("gg7k2m9qxrtb")).toBe(CODE);
    expect(extractLinkCode("GG-7K2M9QXRTO")).toBeNull();
    expect(extractLinkCode("hello")).toBeNull();
    expect(extractLinkCode(undefined)).toBeNull();
  });

  it("builds a wa.me link with the code pre-typed", () => {
    expect(whatsAppChatLink("+15551234567", `Link: ${CODE}`)).toBe(`https://wa.me/15551234567?text=Link%3A%20${CODE}`);
  });
});

describe("phone helpers", () => {
  it("converts WhatsApp ids to E.164 and rejects junk", () => {
    expect(waIdToE164("919876543210")).toBe("+919876543210");
    expect(waIdToE164("012345")).toBeNull();
    expect(waIdToE164("abc")).toBeNull();
  });

  it("masks all but the country code and last four digits", () => {
    expect(maskPhone("+919876543210")).toBe("+91 ••••• 3210");
  });
});

describe("inboundMessages", () => {
  it("extracts text messages sent to our number", () => {
    expect(inboundMessages(webhook(), OWN_NUMBER_ID)).toEqual([
      { messageId: "wamid.1", phone: "+919876543210", profileName: "Asha", text: `Link my GreenGrid account: ${CODE}` },
    ]);
  });

  it("ignores other numbers on the same app, other objects and non-text messages", () => {
    expect(inboundMessages(webhook({ phoneNumberId: "999" }), OWN_NUMBER_ID)).toEqual([]);
    expect(inboundMessages(webhook({ object: "page" }), OWN_NUMBER_ID)).toEqual([]);
    expect(inboundMessages(webhook({ message: { from: "919876543210", id: "wamid.2", type: "image" } }), OWN_NUMBER_ID)).toEqual([]);
  });

  it("treats quick-reply button taps as text", () => {
    const [message] = inboundMessages(
      webhook({ message: { from: "919876543210", id: "wamid.3", type: "button", button: { text: "STOP" } } }),
      OWN_NUMBER_ID,
    );
    expect(message?.text).toBe("STOP");
  });
});

describe("handleWhatsAppMessage", () => {
  it("links the number with a valid code, once", async () => {
    const h = harness();
    await handleWhatsAppMessage(h.deps, inbound(`Link my GreenGrid account: ${CODE}`));
    expect(h.linked.get("+919876543210")).toEqual(["user-1"]);
    expect(h.replies.at(-1)?.text).toMatch(/Connected/);

    await handleWhatsAppMessage(h.deps, inbound(CODE, "+15550000000"));
    expect(h.linked.has("+15550000000")).toBe(false);
    expect(h.replies.at(-1)?.text).toMatch(/expired or was already used/);
  });

  it("rejects an expired code", async () => {
    const h = harness();
    h.advance(LINK_CODE_TTL_MS + 1);
    await handleWhatsAppMessage(h.deps, inbound(CODE));
    expect(h.linked.size).toBe(0);
  });

  it("disconnects on STOP and says so when nothing was connected", async () => {
    const h = harness();
    await handleWhatsAppMessage(h.deps, inbound(CODE));
    await handleWhatsAppMessage(h.deps, inbound("stop"));
    expect(h.linked.size).toBe(0);
    expect(h.replies.at(-1)?.text).toMatch(/Disconnected/);

    await handleWhatsAppMessage(h.deps, inbound("STOP"));
    expect(h.replies.at(-1)?.text).toMatch(/isn't connected/);
  });

  it("answers anything else with help, without linking", async () => {
    const h = harness();
    await handleWhatsAppMessage(h.deps, inbound("hi"));
    expect(h.linked.size).toBe(0);
    expect(h.replies.at(-1)?.text).toMatch(/Connect WhatsApp/);
  });
});

describe("renderWhatsApp", () => {
  it("produces template-safe parameters: no newlines, tabs or long space runs", () => {
    const [title, details] = renderWhatsApp(
      hubMessage({
        title: "New pull request in acme/api",
        body: "**#12** Fix login\n\nOpened by alice\t·    gagan-update → main\n\n- one\n- two",
        buttons: [{ label: "Open pull request", url: "https://github.com/acme/api/pull/12" }],
      }),
    );
    for (const value of [title, details]) {
      expect(value).not.toMatch(/[\r\n\t]/);
      expect(value).not.toMatch(/ {4,}/);
    }
    expect(title).toBe("🔔 New pull request in acme/api");
    expect(details).toContain("#12 Fix login · Opened by alice · gagan-update → main");
    expect(details).toContain("• one · • two");
    expect(details).toContain("Open pull request: https://github.com/acme/api/pull/12");
  });

  it("caps lengths and never sends an empty parameter", () => {
    const [title, details] = renderWhatsApp(hubMessage({ title: "x".repeat(200), body: "" }));
    expect(title.length).toBeLessThanOrEqual(150);
    expect(details).toBe("Open GreenGrid for details.");

    const [, long] = renderWhatsApp(hubMessage({ title: "t", body: "word ".repeat(400) }));
    expect(long.length).toBeLessThanOrEqual(700);
  });
});

describe("whatsAppError", () => {
  const err = (status: number, code?: number) => whatsAppError(status, code === undefined ? {} : { error: { code } });

  it("classifies rate limits as retryable", () => {
    expect(err(429).code).toBe("CHANNEL_RATE_LIMITED");
    expect(err(400, 131056).code).toBe("CHANNEL_RATE_LIMITED");
    expect(err(400, 131056).retryAfterMs).toBeGreaterThan(0);
  });

  it("marks undeliverable recipients as a broken channel", () => {
    expect(err(400, 131026).code).toBe("CHANNEL_UNAVAILABLE");
  });

  it("treats token, template and account problems as server configuration", () => {
    expect(err(401, 190).code).toBe("CONFIGURATION_MISSING");
    expect(err(400, 132001).code).toBe("CONFIGURATION_MISSING");
  });

  it("retries server errors but not malformed requests", () => {
    expect(err(503).retryable).toBe(true);
    expect(err(400, 132018).code).toBe("INTERNAL");
    expect(err(400, 132018).retryable).toBe(false);
  });
});
