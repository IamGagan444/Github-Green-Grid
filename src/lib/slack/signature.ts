import { hmacSha256Hex, safeCompare } from "@/lib/encryption";

const MAX_SKEW_SECONDS = 60 * 5;

/**
 * Verifies a Slack request signature (v0 scheme):
 *   v0=HMAC_SHA256(signingSecret, "v0:" + timestamp + ":" + rawBody)
 * Requests older than five minutes are rejected to prevent replay.
 */
export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowSeconds?: number;
}): boolean {
  const { signingSecret, timestamp, signature, rawBody } = input;
  if (!timestamp || !signature || !signature.startsWith("v0=")) return false;

  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return false;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return false;

  const expected = `v0=${hmacSha256Hex(signingSecret, `v0:${timestamp}:${rawBody}`)}`;
  return safeCompare(expected, signature);
}
