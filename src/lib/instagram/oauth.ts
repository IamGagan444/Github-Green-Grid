import "server-only";

import { getAppUrl, getInstagramConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { callGraph } from "@/lib/instagram/client";

const REQUEST_TIMEOUT_MS = 15_000;

export function getInstagramRedirectUri(): string {
  return `${getAppUrl()}/api/integrations/instagram/callback`;
}

/** Business Login for Instagram consent screen. */
export function buildInstagramAuthorizeUrl(state: string): string {
  const config = getInstagramConfig();
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", getInstagramRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

export interface InstagramTokenGrant {
  accessToken: string;
  expiresInSeconds: number;
  scopes: string[];
}

interface ShortLivedResponse {
  access_token?: string;
  user_id?: string | number;
  permissions?: string[] | string;
  data?: Array<{ access_token: string; user_id: string | number; permissions?: string[] | string }>;
  error_message?: string;
}

function toScopes(value: string[] | string | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.split(",").map((scope) => scope.trim()).filter(Boolean);
}

/**
 * Exchanges the authorization code for a short-lived token, then immediately
 * for a long-lived (60 day) one. Credentials travel in the POST body.
 */
export async function exchangeInstagramCode(code: string): Promise<InstagramTokenGrant> {
  const config = getInstagramConfig();

  let short: ShortLivedResponse;
  try {
    const response = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.appId,
        client_secret: config.appSecret,
        grant_type: "authorization_code",
        redirect_uri: getInstagramRedirectUri(),
        // Instagram appends "#_" to the code in the redirect.
        code: code.replace(/#_$/, ""),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    short = (await response.json()) as ShortLivedResponse;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new AppError("INSTAGRAM_OAUTH_FAILED", "instagram code exchange failed", { cause: error });
  }

  // The endpoint has returned both a flat and a `data: [...]` shape.
  const entry = short.data?.[0] ?? short;
  if (!entry.access_token) throw new AppError("INSTAGRAM_OAUTH_FAILED", "instagram code exchange returned no token");

  const long = await exchangeForLongLived(entry.access_token, config.appSecret);
  return { ...long, scopes: toScopes(entry.permissions) };
}

async function exchangeForLongLived(shortToken: string, appSecret: string) {
  try {
    // Unversioned endpoint. `client_secret` must be a query parameter here;
    // the token itself goes in the Authorization header.
    const data = await callGraph<{ access_token: string; expires_in: number }>("access_token", shortToken, {
      versioned: false,
      query: { grant_type: "ig_exchange_token", client_secret: appSecret },
    });
    return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
  } catch (error) {
    throw new AppError("INSTAGRAM_OAUTH_FAILED", "instagram long-lived token exchange failed", { cause: error });
  }
}

/**
 * Extends a long-lived token by another 60 days. Instagram only refreshes
 * tokens that are at least 24 hours old and not yet expired.
 */
export async function refreshInstagramToken(token: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const data = await callGraph<{ access_token: string; expires_in: number }>("refresh_access_token", token, {
    versioned: false,
    query: { grant_type: "ig_refresh_token" },
  });
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}
