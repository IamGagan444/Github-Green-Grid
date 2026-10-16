import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";

describe("content security policy", () => {
  const policy = buildContentSecurityPolicy("abc123", { development: false });
  const directive = (name: string) => policy.split("; ").find((entry) => entry.startsWith(`${name} `)) ?? "";

  it("runs only nonce-carrying scripts in production", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).not.toContain("unsafe-eval");
    expect(directive("script-src")).not.toContain("unsafe-inline");
  });

  it("forbids framing, plugins and base-tag hijacking", () => {
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("allows eval only in development", () => {
    expect(buildContentSecurityPolicy("n", { development: true })).toContain("'unsafe-eval'");
  });

  it("creates unpredictable 128-bit nonces", () => {
    const nonces = new Set(Array.from({ length: 100 }, () => createNonce()));
    expect(nonces.size).toBe(100);
    expect(Buffer.from(createNonce(), "base64")).toHaveLength(16);
  });
});
