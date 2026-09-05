import { Octokit } from "octokit";
import "server-only";

import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/encryption";
import { GitHubApiError } from "@/lib/github/errors";

const USER_AGENT = "GreenGrid";

/**
 * Builds an Octokit client authenticated as the given user.
 *
 * The decrypted token stays inside this module's closure: callers receive an
 * Octokit instance, never the token itself. Nothing here logs the credential.
 */
export async function getGitHubClient(userId: string): Promise<Octokit> {
  const account = await prisma.gitHubAccount.findUnique({
    where: { userId },
    select: { accessTokenEncrypted: true, tokenExpiresAt: true },
  });

  if (!account) {
    throw new GitHubApiError("UNAUTHORIZED", 401, "No GitHub account linked to this user");
  }

  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now()) {
    throw new GitHubApiError("UNAUTHORIZED", 401, "Stored GitHub token has expired");
  }

  let token: string;
  try {
    token = decryptSecret(account.accessTokenEncrypted);
  } catch {
    // A decryption failure means the encryption key rotated or data is corrupt.
    throw new GitHubApiError("UNAUTHORIZED", 401, "Stored GitHub credential could not be read");
  }

  return new Octokit({
    auth: token,
    userAgent: USER_AGENT,
    request: { timeout: 15_000 },
  });
}

/** Exchanges an OAuth code for an access token. Used only by the auth callback. */
export async function exchangeOAuthCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ accessToken: string; scopes: string[]; expiresInSeconds: number | null }> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new GitHubApiError(
      "UNAVAILABLE",
      response.status,
      `OAuth token exchange failed with status ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
    error?: string;
  };

  if (!payload.access_token) {
    // `payload.error` is a GitHub error slug (e.g. "bad_verification_code");
    // it contains no secret material.
    throw new GitHubApiError(
      "UNAUTHORIZED",
      401,
      `OAuth token exchange rejected: ${payload.error ?? "unknown_error"}`,
    );
  }

  return {
    accessToken: payload.access_token,
    scopes: payload.scope ? payload.scope.split(",").filter(Boolean) : [],
    expiresInSeconds: typeof payload.expires_in === "number" ? payload.expires_in : null,
  };
}

/** Best-effort revocation of the OAuth grant when a user disconnects. */
export async function revokeOAuthToken(
  token: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  await fetch(`https://api.github.com/applications/${clientId}/grant`, {
    method: "DELETE",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ access_token: token }),
    cache: "no-store",
  }).catch(() => {
    // Revocation is best effort; the local credential is deleted regardless.
  });
}
