import "server-only";

import { ConfigurationError, getAppUrl, getLinkedInConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { escapeLittleText, linkedInVersion } from "@/lib/linkedin/format";

/**
 * LinkedIn: OpenID Connect sign-in for the member's identity, and the Posts
 * API to publish on their own profile. Tokens only ever travel in POST bodies
 * and Authorization headers, never in URLs or logs.
 */

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const POSTS_URL = "https://api.linkedin.com/rest/posts";
const REQUEST_TIMEOUT_MS = 15_000;

export const LINKEDIN_SCOPES = ["openid", "profile", "w_member_social"] as const;

export function isLinkedInConfigured(): boolean {
  try {
    getLinkedInConfig();
    return true;
  } catch (error) {
    if (error instanceof ConfigurationError) return false;
    throw error;
  }
}

function config() {
  try {
    return getLinkedInConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) throw new AppError("CONFIGURATION_MISSING", error.message);
    throw error;
  }
}

export function linkedInRedirectUri(): string {
  return `${getAppUrl()}/api/integrations/linkedin/callback`;
}

export function buildLinkedInAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config().clientId,
    redirect_uri: linkedInRedirectUri(),
    state,
    scope: LINKEDIN_SCOPES.join(" "),
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface LinkedInGrant {
  accessToken: string;
  expiresInSeconds: number;
  scopes: string[];
}

export async function exchangeLinkedInCode(code: string): Promise<LinkedInGrant> {
  const { clientId, clientSecret } = config();
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: linkedInRedirectUri(), client_id: clientId, client_secret: clientSecret }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("LINKEDIN_UNAVAILABLE", "linkedin token endpoint unreachable");
  }
  const payload = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    if (response.status >= 500) throw new AppError("LINKEDIN_UNAVAILABLE", `linkedin token ${response.status}`);
    throw new AppError("LINKEDIN_OAUTH_FAILED", `linkedin token exchange failed: ${payload.error ?? response.status}`);
  }
  return {
    accessToken: payload.access_token,
    expiresInSeconds: payload.expires_in ?? 60 * 24 * 3600,
    scopes: (payload.scope ?? "").split(/[ ,]+/).filter(Boolean),
  };
}

export async function fetchLinkedInProfile(accessToken: string): Promise<{ sub: string; name: string | null }> {
  let response: Response;
  try {
    response = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new AppError("LINKEDIN_UNAVAILABLE", "linkedin userinfo unreachable");
  }
  const payload = (await response.json().catch(() => ({}))) as { sub?: string; name?: string };
  if (!response.ok || !payload.sub) throw new AppError("LINKEDIN_OAUTH_FAILED", `linkedin userinfo ${response.status}`);
  return { sub: payload.sub, name: payload.name?.slice(0, 120) ?? null };
}

/** Thrown when LinkedIn definitely did not create the post (safe to retry an at-most-once step). */
export class LinkedInNotPostedError extends AppError {}

/**
 * Publishes an article post on the member's own profile. Returns the post URN.
 * 4xx answers mean nothing was posted; a network failure after sending is
 * ambiguous and is reported as a plain error so the caller won't retry.
 */
export async function createLinkedInPost(input: { accessToken: string; memberSub: string; commentary: string; url: string; title: string }): Promise<string> {
  const body = {
    author: `urn:li:person:${input.memberSub}`,
    commentary: escapeLittleText(input.commentary).slice(0, 3_000),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { article: { source: input.url, title: input.title.slice(0, 200) } },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  let response: Response;
  try {
    response = await fetch(POSTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": process.env.LINKEDIN_API_VERSION?.trim() || linkedInVersion(new Date()),
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("LINKEDIN_UNAVAILABLE", "linkedin posts: network error or timeout");
  }

  if (response.status === 201) return response.headers.get("x-restli-id") ?? response.headers.get("x-linkedin-id") ?? "posted";
  const detail = `linkedin posts ${response.status}`;
  if (response.status === 401) throw new LinkedInNotPostedError("LINKEDIN_TOKEN_REVOKED", detail);
  if (response.status === 429) throw new LinkedInNotPostedError("LINKEDIN_RATE_LIMITED", detail, { retryAfterMs: 60 * 60_000 });
  if (response.status === 403) {
    throw new LinkedInNotPostedError("LINKEDIN_TOKEN_REVOKED", detail, {
      userMessage: "LinkedIn didn't allow this post. Reconnect LinkedIn and make sure sharing is allowed.",
    });
  }
  if (response.status >= 500) throw new AppError("LINKEDIN_UNAVAILABLE", detail);
  throw new LinkedInNotPostedError("INTERNAL", `linkedin rejected post: ${detail}`);
}
