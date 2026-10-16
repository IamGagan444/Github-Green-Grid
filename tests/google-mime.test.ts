import { describe, expect, it } from "vitest";

import { buildMimeMessage, encodeHeaderWord, InvalidEmailError, toGmailRaw } from "@/lib/google/mime";

const base = { to: "customer@example.com", subject: "Payment reminder", html: "<p>Hi</p>", text: "Hi" };

describe("Gmail MIME builder", () => {
  it("cannot be used to inject headers", () => {
    const message = buildMimeMessage({ ...base, subject: "Hello\r\nBcc: victim@example.com" }, "b");
    const headers = message.split("\r\n\r\n")[0]!;
    expect(headers).not.toMatch(/^Bcc:/m);
    expect(headers).toContain("Subject: Hello Bcc: victim@example.com");
  });

  it("rejects invalid or multi-recipient addresses", () => {
    expect(() => buildMimeMessage({ ...base, to: "a@example.com, b@example.com" })).toThrow(InvalidEmailError);
    expect(() => buildMimeMessage({ ...base, to: "not-an-email" })).toThrow(InvalidEmailError);
    expect(() => buildMimeMessage({ ...base, replyTo: "x@y.com\r\nCc: z@z.com" })).toThrow(InvalidEmailError);
  });

  it("encodes non-ASCII subjects and keeps both parts", () => {
    expect(encodeHeaderWord("₹500 due")).toBe(`=?UTF-8?B?${Buffer.from("₹500 due").toString("base64")}?=`);
    const message = buildMimeMessage({ ...base, from: { name: "Asha Traders", address: "owner@gmail.com" } }, "b");
    expect(message).toContain('From: "Asha Traders" <owner@gmail.com>');
    expect(message).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(message).toContain("Content-Type: text/html; charset=UTF-8");
    expect(message.endsWith("--b--\r\n")).toBe(true);
  });

  it("produces base64url for the raw field", () => {
    const raw = toGmailRaw("subject?>>");
    expect(raw).not.toMatch(/[+/=]/);
    expect(Buffer.from(raw, "base64url").toString("utf8")).toBe("subject?>>");
  });
});
