import { describe, expect, it } from "vitest";

import { hubMessage, md, parseInline, whatsAppLink } from "@/lib/hub/message";
import { renderDiscord, renderEmail, renderSlack, renderTelegram } from "@/lib/hub/render";

const hostileTitle = "<script>alert(1)</script> **bold** @everyone <!channel> [x](javascript:alert(1))";

const message = hubMessage({
  title: "New pull request",
  body: `${md.bold("#12")} ${md.text(hostileTitle)}\n\n- one\n- ${md.link("docs", "https://example.com/a (b)")}`,
  buttons: [{ label: "Open", url: "https://github.com/acme/web/pull/12" }],
  waLinks: [{ label: "Reply on WhatsApp", url: whatsAppLink("+919876543210", "Hi there")! }],
  severity: "critical",
});

describe("markdown subset", () => {
  it("escapes untrusted text so it can never become formatting or a link", () => {
    const nodes = parseInline(md.text("**not bold** [x](https://evil.example)"));
    expect(nodes).toEqual([{ type: "text", value: "**not bold** [x](https://evil.example)" }]);
  });

  it("drops links with non-http schemes", () => {
    expect(md.link("click", "javascript:alert(1)")).toBe("click");
    expect(parseInline("[click](javascript:alert(1))").some((node) => node.type === "link")).toBe(false);
  });

  it("builds wa.me links only for E.164 numbers", () => {
    expect(whatsAppLink("+919876543210", "Hello & bye")).toBe("https://wa.me/919876543210?text=Hello%20%26%20bye");
    expect(whatsAppLink("9876543210", "x")).toBeNull();
  });
});

describe("channel rendering", () => {
  it("Telegram: HTML-escaped text and URL buttons, including WhatsApp links", () => {
    const rendered = renderTelegram(message);
    expect(rendered.text).not.toContain("<script>");
    expect(rendered.text).toContain("&lt;script&gt;");
    expect(rendered.text).toContain("<b>#12</b>");
    expect(rendered.text).toContain("• one");
    expect(rendered.text).toContain('<a href="https://example.com/a%20%28b%29">docs</a>');
    expect(rendered.replyMarkup?.inline_keyboard.map((row) => row[0]?.url)).toEqual([
      "https://github.com/acme/web/pull/12",
      "https://wa.me/919876543210?text=Hi%20there",
    ]);
  });

  it("Discord: mentions are neutralised and no mention can ping", () => {
    const payload = renderDiscord(message);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0]?.description).not.toContain("@everyone");
    expect(payload.embeds[0]?.description).toContain("[Open](https://github.com/acme/web/pull/12)");
    expect(payload.embeds[0]?.color).toBe(0xef4444);
  });

  it("Slack: control sequences are escaped and buttons become an actions block", () => {
    const rendered = renderSlack(message);
    expect(rendered.text).not.toContain("<!channel>");
    expect(rendered.text).toContain("&lt;!channel&gt;");
    const actions = rendered.blocks.find((block) => (block as { type: string }).type === "actions") as {
      elements: Array<{ url: string }>;
    };
    expect(actions.elements).toHaveLength(2);
  });

  it("Email: HTML is escaped and a plain-text part is included", () => {
    const rendered = renderEmail(message);
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.text).toContain("Open: https://github.com/acme/web/pull/12");
    expect(rendered.subject).toBe("New pull request");
  });

  it("Telegram falls back to escaped plain text when the message is too long", () => {
    // 3,000 "<" characters become 12,000 characters of "&lt;" in HTML.
    const long = hubMessage({ title: "Digest", body: md.text("<".repeat(3_000), 3_000) });
    const rendered = renderTelegram(long);
    expect(rendered.text.length).toBeLessThanOrEqual(4_096);
    expect(rendered.text).not.toContain("<b>");
  });
});
