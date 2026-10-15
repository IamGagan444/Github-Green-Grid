import crypto from "node:crypto";

import { hmacSha256Hex, safeCompare } from "@/lib/encryption";

/**
 * Verifies Meta's webhook signature:
 *   X-Hub-Signature-256: sha256=HMAC_SHA256(appSecret, rawBody)
 * The raw request body must be used byte-for-byte; re-serialised JSON fails.
 */
export function verifyMetaSignature(input: { appSecret: string; signature: string | null; rawBody: string }): boolean {
  const { appSecret, signature, rawBody } = input;
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = `sha256=${hmacSha256Hex(appSecret, rawBody)}`;
  return safeCompare(expected, signature);
}

/**
 * Parses and verifies a Meta `signed_request` (deauthorize and data-deletion
 * callbacks): `<base64url sig>.<base64url JSON>`, signed with HMAC-SHA256.
 */
export function parseSignedRequest<T extends Record<string, unknown>>(
  signedRequest: string | null,
  appSecret: string,
): T | null {
  if (!signedRequest) return null;
  const [encodedSig, encodedPayload] = signedRequest.split(".", 2);
  if (!encodedSig || !encodedPayload) return null;

  const expected = crypto.createHmac("sha256", appSecret).update(encodedPayload).digest();
  const received = Buffer.from(encodedSig, "base64url");
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as T & { algorithm?: string };
    if (payload.algorithm && payload.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    return payload;
  } catch {
    return null;
  }
}
