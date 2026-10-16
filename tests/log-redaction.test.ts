import { describe, expect, it } from "vitest";

import { redactForLog, redactPii, redactString } from "@/lib/logging/logger";

describe("log redaction", () => {
  it("removes the new credential formats", () => {
    const line = redactString(
      [
        "tg 123456789:AAH-abcdefghijklmnopqrstuvwxyz0123456",
        "google ya29.a0AfH6SMBabcdefghijklmnop",
        "refresh 1//0gabcdefghijklmnopqrstu",
        "key AIzaSyA1234567890abcdefghijklmnopqrst",
        "groq gsk_abcdefghijklmnopqrstuv",
        "https://discord.com/api/webhooks/123456789/abcDEF_ghi-jkl",
        "https://api.telegram.org/bot123:abc/sendMessage",
      ].join(" "),
    );
    for (const secret of ["AAH-abc", "ya29.", "1//0g", "AIzaSy", "gsk_", "abcDEF_ghi", "bot123:abc"]) {
      expect(line).not.toContain(secret);
    }
  });

  it("removes emails and phone numbers from log output", () => {
    expect(redactPii("mail alice@example.com or call +91 98765 43210")).toBe("mail [EMAIL] or call [PHONE]");
  });

  it("keeps ordinary values intact", () => {
    expect(redactPii("2026-10-16T10:00:00Z took 120 ms, id cmabc123")).toBe("2026-10-16T10:00:00Z took 120 ms, id cmabc123");
  });

  it("redacts nested context, credential keys and error messages", () => {
    const output = redactForLog({
      user: { email: "bob@example.com", phone: "+14155550123" },
      authorization: "Bearer abc",
      error: new Error("failed for bob@example.com"),
    });
    expect(JSON.stringify(output)).not.toMatch(/bob@example\.com|\+14155550123|Bearer abc/);
  });
});
