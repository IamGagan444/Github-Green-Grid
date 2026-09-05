import type { Octokit } from "octokit";
import "server-only";

import { toGitHubApiError } from "@/lib/github/errors";
import type { GitHubUserProfile } from "@/lib/github/types";

const USER_AGENT = "GreenGrid";

/** Fetches the authenticated profile using a freshly issued OAuth token. */
export async function fetchProfileWithToken(token: string): Promise<GitHubUserProfile> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw toGitHubApiError({ status: response.status }, "fetchProfileWithToken");
  }

  const user = (await response.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
    email: string | null;
  };

  return {
    githubUserId: String(user.id),
    username: user.login,
    displayName: user.name,
    avatarUrl: user.avatar_url,
    email: user.email ?? (await fetchPrimaryEmail(token)),
  };
}

/** Reads the verified primary email when the `user:email` scope was granted. */
async function fetchPrimaryEmail(token: string): Promise<string | null> {
  const response = await fetch("https://api.github.com/user/emails", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const emails = (await response.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;

  return emails.find((entry) => entry.primary && entry.verified)?.email ?? null;
}

/** Refreshes the stored profile for an already-connected account. */
export async function getAuthenticatedProfile(
  octokit: Octokit,
): Promise<GitHubUserProfile> {
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    return {
      githubUserId: String(data.id),
      username: data.login,
      displayName: data.name ?? null,
      avatarUrl: data.avatar_url ?? null,
      email: data.email ?? null,
    };
  } catch (error) {
    throw toGitHubApiError(error, "getAuthenticatedProfile");
  }
}
