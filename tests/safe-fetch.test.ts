import { describe, expect, it } from "vitest";

import { assertPublicUrl, isPrivateAddress, safeFetch } from "@/lib/net/safe-fetch";

const publicResolver = async () => ["93.184.216.34"];

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::a00:1",
  ])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("allows %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  it("rejects non-http schemes, credentials and local names", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(assertPublicUrl("https://user:pass@example.com", { resolver: publicResolver })).rejects.toMatchObject({
      code: "INVALID_URL",
    });
    await expect(assertPublicUrl("http://localhost:3000")).rejects.toMatchObject({ code: "BLOCKED" });
    await expect(assertPublicUrl("http://metadata.google.internal")).rejects.toMatchObject({ code: "BLOCKED" });
    await expect(assertPublicUrl("http://[::1]/")).rejects.toMatchObject({ code: "BLOCKED" });
  });

  it("rejects hosts that resolve to private addresses (DNS-based SSRF)", async () => {
    await expect(assertPublicUrl("https://evil.example", { resolver: async () => ["93.184.216.34", "127.0.0.1"] })).rejects.toMatchObject({
      code: "BLOCKED",
    });
  });

  it("enforces https when asked", async () => {
    await expect(assertPublicUrl("http://example.com", { httpsOnly: true, resolver: publicResolver })).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });
});

describe("safeFetch", () => {
  it("re-validates every redirect hop", async () => {
    const fetchImpl = (async (url: URL) =>
      url.hostname === "example.com"
        ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })
        : new Response("secret")) as unknown as typeof fetch;
    await expect(safeFetch("https://example.com", { fetchImpl, resolver: publicResolver })).rejects.toMatchObject({ code: "BLOCKED" });
  });

  it("caps redirects and response size", async () => {
    const loop = (async () => new Response(null, { status: 302, headers: { location: "https://example.com/again" } })) as unknown as typeof fetch;
    await expect(safeFetch("https://example.com", { fetchImpl: loop, resolver: publicResolver })).rejects.toMatchObject({
      code: "TOO_MANY_REDIRECTS",
    });

    const big = (async () => new Response("x".repeat(5_000))) as unknown as typeof fetch;
    await expect(safeFetch("https://example.com", { fetchImpl: big, resolver: publicResolver, maxBytes: 1_000 })).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
  });

  it("returns the body for a normal public response", async () => {
    const fetchImpl = (async () => new Response("hello", { status: 200 })) as unknown as typeof fetch;
    const response = await safeFetch("https://example.com/feed", { fetchImpl, resolver: publicResolver });
    expect(response.status).toBe(200);
    expect(response.text()).toBe("hello");
  });
});
