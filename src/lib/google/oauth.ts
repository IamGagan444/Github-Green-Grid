import "server-only";

import { getAppUrl, getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * "Connect Google" for Sheets and Gmail, separate from sign-in. Only
 * non-restricted scopes are requested: drive.file (files GreenGrid creates)
 * and gmail.send (send-only). Read scopes would trigger Google's paid
 * security assessment and are deliberately never asked for.
 */

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const REQUEST_TIMEOUT_MS = 15_000;

export function getGoogleRedirectUri(): string {
  return `${getAppUrl()}/api/integrations/google/callback`;
}

export function buildGoogleAuthorizeUrl(state: string, loginHint?: string | null): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", getEnv().GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", getGoogleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  // Always re-consent so Google returns a refresh token every time.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export interface GoogleTokenGrant {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  scopes: string[];
}

async function tokenRequest(params: Record<string, string>): Promise<GoogleTokenGrant> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getEnv();
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("GOOGLE_UNAVAILABLE", "google token endpoint unreachable");
  }

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    if (payload.error === "invalid_grant") throw new AppError("GOOGLE_TOKEN_REVOKED", "google refresh token invalid");
    if (response.status >= 500) throw new AppError("GOOGLE_UNAVAILABLE", `google token endpoint ${response.status}`);
    throw new AppError("GOOGLE_OAUTH_FAILED", `google token exchange failed: ${payload.error ?? response.status}`);
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresInSeconds: payload.expires_in ?? 3600,
    scopes: (payload.scope ?? "").split(" ").filter(Boolean),
  };
}

export function exchangeGoogleCode(code: string): Promise<GoogleTokenGrant> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: getGoogleRedirectUri() });
}

export function refreshGoogleToken(refreshToken: string): Promise<GoogleTokenGrant> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function fetchGoogleProfile(accessToken: string): Promise<{ sub: string; email: string }> {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) throw new AppError("GOOGLE_OAUTH_FAILED", `google userinfo failed ${response?.status ?? "network"}`);
  const profile = (await response.json()) as { sub?: string; email?: string; email_verified?: boolean };
  if (!profile.sub || !profile.email || profile.email_verified === false) {
    throw new AppError("GOOGLE_OAUTH_FAILED", "google profile missing verified email");
  }
  return { sub: profile.sub, email: profile.email.toLowerCase() };
}

/** Best effort: revoking a refresh token also invalidates its access tokens. */
export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);
}
