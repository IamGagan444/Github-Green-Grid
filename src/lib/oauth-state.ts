import { cookies } from "next/headers";
import "server-only";

import { randomToken, safeCompare } from "@/lib/encryption";
import { isProduction } from "@/lib/env";

/**
 * Single-use OAuth `state` for integration connect flows (GitHub, Slack).
 *
 * The state is random, stored in an httpOnly cookie scoped to the callback, and
 * bound to the user who started the flow. The callback rejects the request if
 * the state does not match, has expired, or belongs to a different user — so a
 * forged callback cannot attach an attacker's GitHub/Slack account to a victim.
 */

export type OAuthProvider = "github" | "slack";

const STATE_TTL_SECONDS = 600;

function cookieName(provider: OAuthProvider): string {
  return `greengrid_${provider}_oauth`;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

interface StatePayload {
  state: string;
  userId: string;
  returnTo: string;
}

export async function issueOAuthState(
  provider: OAuthProvider,
  userId: string,
  returnTo: string,
): Promise<string> {
  const state = randomToken(24);
  const payload: StatePayload = { state, userId, returnTo: sanitiseReturnTo(returnTo) };
  const store = await cookies();
  store.set(
    cookieName(provider),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    cookieOptions(STATE_TTL_SECONDS),
  );
  return state;
}

export type StateCheck =
  | { valid: true; returnTo: string }
  | { valid: false; reason: "missing_state" | "invalid_state" | "user_mismatch"; returnTo: string };

/** Consumes (always clears) the state cookie and validates it. */
export async function consumeOAuthState(
  provider: OAuthProvider,
  receivedState: string | null,
  currentUserId: string,
): Promise<StateCheck> {
  const store = await cookies();
  const raw = store.get(cookieName(provider))?.value;
  store.set(cookieName(provider), "", cookieOptions(0));

  if (!raw || !receivedState) return { valid: false, reason: "missing_state", returnTo: "/settings" };

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return { valid: false, reason: "invalid_state", returnTo: "/settings" };
  }

  const returnTo = sanitiseReturnTo(payload.returnTo);
  if (typeof payload.state !== "string" || !safeCompare(payload.state, receivedState)) {
    return { valid: false, reason: "invalid_state", returnTo };
  }
  if (payload.userId !== currentUserId) {
    return { valid: false, reason: "user_mismatch", returnTo };
  }
  return { valid: true, returnTo };
}

/** Only same-origin relative paths are accepted as post-flow destinations. */
export function sanitiseReturnTo(value: string | null | undefined, fallback = "/settings"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
