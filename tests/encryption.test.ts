import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const TEST_KEY = crypto.randomBytes(32).toString("base64");

beforeAll(() => {
  process.env.GITHUB_TOKEN_ENCRYPTION_KEY = TEST_KEY;
});

const { encryptSecret, decryptSecret, safeCompare, hashToken, randomToken } = await import(
  "@/lib/encryption"
);

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a token", () => {
    const token = "ghp_" + "a".repeat(36);
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("never stores the plaintext in the ciphertext payload", () => {
    const token = "ghp_supersecretvalue";
    expect(encryptSecret(token)).not.toContain(token);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const token = "ghp_supersecretvalue";
    expect(encryptSecret(token)).not.toBe(encryptSecret(token));
  });

  it("rejects a tampered payload", () => {
    const payload = encryptSecret("ghp_supersecretvalue");
    const parts = payload.split(".");
    const tampered = [parts[0], parts[1], parts[2], "AAAA" + parts[3]].join(".");

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-payload")).toThrow("Malformed encrypted payload");
  });
});

describe("safeCompare", () => {
  it("accepts identical secrets", () => {
    expect(safeCompare("s3cret-value", "s3cret-value")).toBe(true);
  });

  it("rejects different secrets of equal length", () => {
    expect(safeCompare("s3cret-value", "s3cret-valuX")).toBe(false);
  });

  it("rejects secrets of different lengths without throwing", () => {
    expect(safeCompare("short", "much-longer-secret")).toBe(false);
  });
});

describe("hashToken / randomToken", () => {
  it("hashes deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("does not reveal the token", () => {
    expect(hashToken("session-token")).not.toContain("session-token");
  });

  it("generates unique URL-safe tokens", () => {
    const first = randomToken(32);
    const second = randomToken(32);

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
