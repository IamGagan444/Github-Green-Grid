import crypto from "node:crypto";
import "server-only";

/**
 * Authenticated encryption for GitHub credentials at rest.
 *
 * Format: `v1.<iv-b64>.<authTag-b64>.<ciphertext-b64>`
 * Algorithm: AES-256-GCM with a random 12-byte IV per record.
 *
 * Generate a key with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * and set it as GITHUB_TOKEN_ENCRYPTION_KEY.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const VERSION = "v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY is not configured");
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "GITHUB_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of 32 random bytes)",
    );
  }

  cachedKey = key;
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed encrypted payload");
  }

  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Constant-time comparison for secrets supplied by callers (e.g. CRON_SECRET). */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
