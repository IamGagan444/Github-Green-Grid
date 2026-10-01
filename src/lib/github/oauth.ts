import "server-only";

import { getAppUrl, getEnv } from "@/lib/env";

/**
 * GreenGrid authenticates as a GitHub App acting on behalf of the user
 * (user-to-server tokens). For a GitHub App, access is governed by the App's
 * fine-grained permissions and the repositories it is installed on — the
 * `scope` parameter is ignored. Required App permissions:
 *
 * - Contents: Read & write — read commits for standups; write the GreenGrid
 *   activity file (commit-activity feature only).
 * - Metadata: Read-only — list repositories and branches.
 * - Account permissions → Email addresses: Read-only — identify the user.
 *
 * The scopes below apply only if the credentials belong to a classic OAuth App.
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

