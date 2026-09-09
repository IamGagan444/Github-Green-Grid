import { Octokit } from "octokit";
import "server-only";

import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/encryption";
import { getEnv } from "@/lib/env";
import { GitHubApiError } from "@/lib/github/errors";

const USER_AGENT = "GreenGrid";

/**
 * Refresh slightly before the real expiry so a token cannot lapse midway
 * through a run that has already started.
 */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

function decrypt(ciphertext: string): string {
  try {
    return decryptSecret(ciphertext);
  } catch {
    // A decryption failure means the encryption key rotated or data is corrupt.
    throw new GitHubApiError("UNAUTHORIZED", 401, "Stored GitHub credential could not be read");
  }
}

/**
 * Builds an Octokit client authenticated as the given user.
 *
 * When the GitHub App is configured to expire user tokens, the stored access
 * token is short-lived (8 hours). Rather than forcing the user to reconnect,
 * an expiring token is exchanged for a fresh one using the stored refresh
 * token, and the new pair is persisted.
 *
 * The decrypted token stays inside this module's closure: callers receive an
 * Octokit instance, never the token itself. Nothing here logs the credential.
 */
export async function getGitHubClient(userId: string): Promise<Octokit> {
  const account = await prisma.gitHubAccount.findUnique({
    where: { userId },
    select: {
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      tokenExpiresAt: true,
    },
  });

  if (!account) {
    throw new GitHubApiError("UNAUTHORIZED", 401, "No GitHub account linked to this user");
  }

  const expiresSoon =
    account.tokenExpiresAt !== null &&
    account.tokenExpiresAt.getTime() - EXPIRY_SKEW_MS < Date.now();

  let token = decrypt(account.accessTokenEncrypted);

  if (expiresSoon) {
    if (!account.refreshTokenEncrypted) {
      throw new GitHubApiError(
        "UNAUTHORIZED",
        401,
        "Stored GitHub token has expired and no refresh token is available",
      );
    }

    token = await refreshStoredToken(userId, decrypt(account.refreshTokenEncrypted));
  }

  return new Octokit({
    auth: token,
    userAgent: USER_AGENT,
    request: { timeout: 15_000 },
  });
}

/**
 * Exchanges a refresh token for a new access token and stores the new pair.
 *
 * GitHub invalidates a refresh token once it is used, so two runs refreshing
 * concurrently will see one succeed and one rejected. The loser re-reads the
 * row and uses the token the winner just stored instead of failing the run.
 */
async function refreshStoredToken(userId: string, refreshToken: string): Promise<string> {
  let refreshed: OAuthTokenResponse;

  try {
    refreshed = await requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  } catch (error) {
    const current = await prisma.gitHubAccount.findUnique({
      where: { userId },
      select: { accessTokenEncrypted: true, tokenExpiresAt: true },
    });

    const stillValid =
      current !== null &&
      current.tokenExpiresAt !== null &&
      current.tokenExpiresAt.getTime() - EXPIRY_SKEW_MS >= Date.now();

    if (stillValid && current) return decrypt(current.accessTokenEncrypted);
    throw error;
  }

  await prisma.gitHubAccount.update({
    where: { userId },
    data: {
      accessTokenEncrypted: encryptSecret(refreshed.accessToken),
      ...(refreshed.refreshToken
        ? { refreshTokenEncrypted: encryptSecret(refreshed.refreshToken) }
        : {}),
      tokenExpiresAt: refreshed.expiresInSeconds
        ? new Date(Date.now() + refreshed.expiresInSeconds * 1000)
        : null,
    },
  });

  return refreshed.accessToken;
}

export interface OAuthTokenResponse {
  accessToken: string;
  scopes: string[];
  expiresInSeconds: number | null;
  /** Present only when the app issues expiring user tokens. */
  refreshToken: string | null;
  refreshTokenExpiresInSeconds: number | null;
}

/**
 * Posts to GitHub's token endpoint. Shared by the initial code exchange and by
 * refreshes, since both use the same endpoint and response shape.
 */
async function requestToken(
  params: Record<string, string>,
): Promise<OAuthTokenResponse> {
  const env = getEnv();

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      ...params,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new GitHubApiError(
      "UNAVAILABLE",
      response.status,
      `OAuth token request failed with status ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error?: string;
  };

  if (!payload.access_token) {
    // `payload.error` is a GitHub error slug (e.g. "bad_verification_code");
    // it contains no secret material.
    throw new GitHubApiError(
      "UNAUTHORIZED",
      401,
      `OAuth token request rejected: ${payload.error ?? "unknown_error"}`,
    );
  }

  return {
    accessToken: payload.access_token,
    scopes: payload.scope ? payload.scope.split(",").filter(Boolean) : [],
    expiresInSeconds: typeof payload.expires_in === "number" ? payload.expires_in : null,
    refreshToken: payload.refresh_token ?? null,
    refreshTokenExpiresInSeconds:
      typeof payload.refresh_token_expires_in === "number"
        ? payload.refresh_token_expires_in
        : null,
  };
}

/** Exchanges an OAuth code for an access token. Used only by the auth callback. */
export async function exchangeOAuthCode(
  code: string,
  redirectUri: string,
): Promise<OAuthTokenResponse> {
  return requestToken({ code, redirect_uri: redirectUri });
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
