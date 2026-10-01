import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const { decryptSecret, encryptSecret, resetEncryptionKeyCache } = await import("@/lib/encryption");
const { redact, redactString } = await import("@/lib/logging/logger");
const { sanitiseAuditMetadata } = await import("@/services/audit-service");

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  resetEncryptionKeyCache();
});

describe("token encryption key", () => {
  it("encrypts and decrypts with ENCRYPTION_KEY", () => {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    const ciphertext = encryptSecret("xoxb-123-secret");
    expect(ciphertext).not.toContain("xoxb");
    expect(decryptSecret(ciphertext)).toBe("xoxb-123-secret");
  });

  it("still reads the legacy GITHUB_TOKEN_ENCRYPTION_KEY so existing data decrypts", () => {
    const key = crypto.randomBytes(32).toString("base64");
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = key;
    const ciphertext = encryptSecret("gho_legacy");
    resetEncryptionKeyCache();
    delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = key;
    expect(decryptSecret(ciphertext)).toBe("gho_legacy");
  });

  it("fails closed with a different key", () => {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    const ciphertext = encryptSecret("secret");
    resetEncryptionKeyCache();
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    expect(() => decryptSecret(ciphertext)).toThrow();
  });
});

describe("log redaction", () => {
  it("redacts known token formats inside strings", () => {
    const line = redactString(
      "call failed with xoxb-1234-5678-abcdef and ghu_abcdefghijklmnopqrstuvwxyz0123 Bearer nvapi-abcdefghijklmnop",
    );
    expect(line).not.toMatch(/xoxb-1234|ghu_abc|nvapi-abc/);
    expect(line).toContain("[REDACTED]");
  });

  it("redacts credential-shaped keys at any depth", () => {
    expect(redact({ ok: 1, nested: { accessToken: "x", clientSecret: "y", authorization: "z" } })).toEqual({
      ok: 1,
      nested: { accessToken: "[REDACTED]", clientSecret: "[REDACTED]", authorization: "[REDACTED]" },
    });
  });
});

describe("audit metadata", () => {
  it("never stores tokens or secrets", () => {
    const cleaned = sanitiseAuditMetadata({ teamId: "T1", botToken: "xoxb-1-2-3", note: "used xoxp-9-9-9" });
    const serialised = JSON.stringify(cleaned);
    expect(serialised).not.toContain("xoxb-1-2-3");
    expect(serialised).not.toContain("xoxp-9-9-9");
    expect(serialised).toContain("T1");
  });

  it("bounds metadata size", () => {
    expect(sanitiseAuditMetadata({ blob: "x".repeat(10_000) })).toEqual({ truncated: true });
  });
});
