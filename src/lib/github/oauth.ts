import "server-only";

import { getAppUrl, getEnv } from "@/lib/env";

/**
 * Scopes requested at authorization time.
 *
 * - `repo`       write access to the repository the user selects, including
 *                private repositories. GitHub has no narrower scope for
 *                committing to a private repo via the Contents API.
 * - `read:user`  profile fields shown in the dashboard.
 * - `user:email` primary email, used only for account identification.
 */
export const OAUTH_SCOPES = ["repo", "read:user", "user:email"] as const;

export function getRedirectUri(): string {
  return `${getAppUrl()}/api/auth/github/callback`;
}

export function buildAuthorizeUrl(state: string): string {
  const env = getEnv();
  const url = new URL("https://github.com/login/oauth/authorize");

  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");

  return url.toString();
}

/** Only same-origin relative paths are accepted as post-login destinations. */
export function sanitiseReturnTo(value: string | null): string {
  if (!value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
