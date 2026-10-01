import "server-only";

import { cached } from "@/lib/cache/redis";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/encryption";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  fetchAuthoredCommits,
  getGitHubClient,
  getRepository,
  toGitHubApiError,
  GitHubApiError,
  listBranches,
  listUserRepositories,
  revokeOAuthToken,
  type AuthoredCommit,
  type GitHubBranchSummary,
  type GitHubRepositorySummary,
  type GitHubUserProfile,
} from "@/lib/github";
import type { OAuthTokenResponse } from "@/lib/github/github-client";
import { createLogger } from "@/lib/logging/logger";
import { withRetry } from "@/lib/retry";
import type { AutomationSnapshot, GitHubPort } from "@/lib/automation/types";
import { recordAudit } from "@/services/audit-service";

const log = createLogger("github-service");

/** Maps the GitHub client's error type onto the application error taxonomy. */
export function githubToAppError(error: unknown, context: string): AppError {
  if (error instanceof AppError) return error;
  if (!(error instanceof GitHubApiError)) {
    return new AppError("GITHUB_UNAVAILABLE", `${context}: unexpected error`, { cause: error });
  }
  const internal = `${context}: ${error.message}`;
  switch (error.code) {
    case "UNAUTHORIZED":
      return new AppError("GITHUB_TOKEN_REVOKED", internal);
    case "FORBIDDEN":
      return new AppError("GITHUB_PERMISSION_DENIED", internal);
    case "NOT_FOUND":
    case "VALIDATION_FAILED":
      return new AppError("REPOSITORY_UNAVAILABLE", internal);
    case "RATE_LIMITED":
      return new AppError("GITHUB_RATE_LIMITED", internal);
    default:
      return new AppError("GITHUB_UNAVAILABLE", internal);
  }
}

/** Runs a GitHub operation for a user, marking the integration revoked on 401. */
async function withGitHub<T>(
  userId: string,
  context: string,
  operation: (octokit: Awaited<ReturnType<typeof getGitHubClient>>) => Promise<T>,
): Promise<T> {
  try {
    return await withRetry(
      async () => {
        try {
          const octokit = await getGitHubClient(userId);
          return await operation(octokit);
        } catch (error) {
          throw githubToAppError(error, context);
        }
      },
      { attempts: 3, baseDelayMs: 1_000 },
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "GITHUB_TOKEN_REVOKED") {
      await markRevokedIfConnected(userId);
    }
    throw error;
  }
}

async function markRevokedIfConnected(userId: string): Promise<void> {
  const { count } = await prisma.gitHubIntegration.updateMany({
    where: { userId, status: "CONNECTED", accessTokenEncrypted: { not: null } },
    data: { status: "REVOKED" },
  });
  if (count > 0) log.warn("github integration marked revoked", { userId });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status & connection lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export interface GitHubIntegrationView {
  connected: boolean;
  status: "CONNECTED" | "DISCONNECTED" | "REVOKED" | "NOT_CONNECTED";
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  connectedAt: Date | null;
}

/** Public, token-free view of a user's GitHub integration. */
export async function getGitHubIntegration(userId: string): Promise<GitHubIntegrationView> {
  const integration = await prisma.gitHubIntegration.findUnique({
    where: { userId },
    select: { status: true, username: true, displayName: true, avatarUrl: true, connectedAt: true },
  });
  if (!integration) {
    return {
      connected: false,
      status: "NOT_CONNECTED",
      username: null,
      displayName: null,
      avatarUrl: null,
      connectedAt: null,
    };
  }
  return {
    connected: integration.status === "CONNECTED",
    status: integration.status,
    username: integration.username,
    displayName: integration.displayName,
    avatarUrl: integration.avatarUrl,
    connectedAt: integration.connectedAt,
  };
}

export type ConnectOutcome = "connected" | "claimed_legacy" | "linked_elsewhere";

/**
 * Stores a freshly authorised GitHub identity for `userId`.
 *
 * If the GitHub account is already attached to a *different* user:
 *  - a legacy GreenGrid account (signed up with GitHub before Google sign-in
 *    existed, so it has no email) is merged into the current user — proving
 *    control of the GitHub account through OAuth is proof of ownership;
 *  - any other account is refused, so one GitHub identity cannot feed two
 *    users' automations.
 */
export async function connectGitHub(
  userId: string,
  profile: GitHubUserProfile,
  tokens: OAuthTokenResponse,
): Promise<ConnectOutcome> {
  const credentialData = {
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    email: profile.email,
    status: "CONNECTED" as const,
    accessTokenEncrypted: encryptSecret(tokens.accessToken),
    refreshTokenEncrypted: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
    tokenExpiresAt: tokens.expiresInSeconds ? new Date(Date.now() + tokens.expiresInSeconds * 1000) : null,
    scopes: tokens.scopes,
    connectedAt: new Date(),
    disconnectedAt: null,
  };

  const existing = await prisma.gitHubIntegration.findUnique({
    where: { githubUserId: profile.githubUserId },
    select: { userId: true, user: { select: { email: true } } },
  });

  let outcome: ConnectOutcome = "connected";

  if (existing && existing.userId !== userId) {
    if (existing.user.email !== null) return "linked_elsewhere";

    const legacyUserId = existing.userId;
    await prisma.$transaction(async (tx) => {
      // Detach the current user's previous GitHub identity (if any).
      await tx.gitHubIntegration.deleteMany({ where: { userId } });
      await tx.repository.updateMany({ where: { userId: legacyUserId }, data: { userId } });
      await tx.schedule.updateMany({ where: { userId: legacyUserId }, data: { userId } });
      await tx.activityExecution.updateMany({ where: { userId: legacyUserId }, data: { userId } });
      await tx.gitHubIntegration.update({
        where: { githubUserId: profile.githubUserId },
        data: { ...credentialData, userId },
      });
      await tx.user.delete({ where: { id: legacyUserId } });
    });
    outcome = "claimed_legacy";
  } else {
    // A user switching to a different GitHub account replaces the old identity.
    await prisma.$transaction(async (tx) => {
      await tx.gitHubIntegration.deleteMany({
        where: { userId, NOT: { githubUserId: profile.githubUserId } },
      });
      await tx.gitHubIntegration.upsert({
        where: { githubUserId: profile.githubUserId },
        create: { ...credentialData, githubUserId: profile.githubUserId, userId },
        update: credentialData,
      });
    });
  }

  await recordAudit({
    actorUserId: userId,
    action: "GITHUB_CONNECTED",
    targetType: "GitHubIntegration",
    targetId: profile.githubUserId,
    metadata: { username: profile.username, legacyAccountMerged: outcome === "claimed_legacy" },
  });

  return outcome;
}

/**
 * Disconnects GitHub: revokes the grant at GitHub (best effort), wipes stored
 * credentials, and marks the integration disconnected. Automations and history
 * are preserved; automations stop executing until GitHub is reconnected.
 */
export async function disconnectGitHub(userId: string): Promise<void> {
  const integration = await prisma.gitHubIntegration.findUnique({
    where: { userId },
    select: { id: true, username: true, accessTokenEncrypted: true },
  });
  if (!integration) return;

  if (integration.accessTokenEncrypted) {
    try {
      const env = getEnv();
      await revokeOAuthToken(
        decryptSecret(integration.accessTokenEncrypted),
        env.GITHUB_CLIENT_ID,
        env.GITHUB_CLIENT_SECRET,
      );
    } catch {
      // Best effort; local deletion proceeds regardless.
    }
  }

  await prisma.$transaction([
    prisma.gitHubIntegration.update({
      where: { userId },
      data: {
        status: "DISCONNECTED",
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        disconnectedAt: new Date(),
      },
    }),
    // GreenGrid commit-activity schedules cannot run without GitHub either.
    prisma.schedule.updateMany({ where: { userId, enabled: true }, data: { enabled: false } }),
  ]);

  await recordAudit({
    actorUserId: userId,
    action: "GITHUB_DISCONNECTED",
    targetType: "GitHubIntegration",
    targetId: integration.id,
    metadata: { username: integration.username },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository data
// ─────────────────────────────────────────────────────────────────────────────

const REPOSITORY_CACHE_SECONDS = 5 * 60;
const BRANCH_CACHE_SECONDS = 5 * 60;

/**
 * Cache namespace for the user's current GitHub connection. It includes the
 * connection time, so reconnecting (or switching GitHub account) starts clean.
 */
function githubCacheScope(userId: string, identity: { githubUserId: string; connectedAt: Date }): string {
  return `gh:${userId}:${identity.githubUserId}:${identity.connectedAt.getTime()}`;
}

export async function listAccessibleRepositories(
  userId: string,
  options: { refresh?: boolean } = {},
): Promise<GitHubRepositorySummary[]> {
  const identity = await requireConnectedIdentity(userId);
  return cached(
    `${githubCacheScope(userId, identity)}:repos`,
    REPOSITORY_CACHE_SECONDS,
    () => withGitHub(userId, "listAccessibleRepositories", (octokit) => listUserRepositories(octokit)),
    { bypass: options.refresh },
  );
}

export async function listRepositoryBranches(
  userId: string,
  owner: string,
  name: string,
  options: { refresh?: boolean } = {},
): Promise<GitHubBranchSummary[]> {
  const identity = await requireConnectedIdentity(userId);
  return cached(
    `${githubCacheScope(userId, identity)}:branches:${owner.toLowerCase()}/${name.toLowerCase()}`,
    BRANCH_CACHE_SECONDS,
    () => withGitHub(userId, "listRepositoryBranches", (octokit) => listBranches(octokit, owner, name)),
    { bypass: options.refresh },
  );
}

async function requireConnectedIdentity(
  userId: string,
): Promise<{ username: string; githubUserId: string; connectedAt: Date }> {
  const integration = await prisma.gitHubIntegration.findUnique({
    where: { userId },
    select: { status: true, username: true, githubUserId: true, connectedAt: true },
  });
  if (!integration) throw new AppError("GITHUB_NOT_CONNECTED", "no github integration");
  if (integration.status === "REVOKED") throw new AppError("GITHUB_TOKEN_REVOKED", "github integration revoked");
  if (integration.status !== "CONNECTED") throw new AppError("GITHUB_NOT_CONNECTED", "github integration disconnected");
  return { username: integration.username, githubUserId: integration.githubUserId, connectedAt: integration.connectedAt };
}

export async function fetchCommitsForSources(
  userId: string,
  sources: AutomationSnapshot["githubSources"],
  window: { since: Date; until: Date },
  includeFiles: boolean,
): Promise<{ commits: AuthoredCommit[]; perSource: Array<{ fullName: string; branch: string | null; commitCount: number }> }> {
  // Zero sources would otherwise look like "no commits today" and be skipped silently.
  if (sources.length === 0) throw new AppError("REPOSITORY_UNAVAILABLE", "automation has no GitHub sources");
  const identity = await requireConnectedIdentity(userId);
  const commits: AuthoredCommit[] = [];
  const perSource: Array<{ fullName: string; branch: string | null; commitCount: number }> = [];

  for (const source of sources) {
    const found = await withGitHub(userId, `fetchCommits:${source.fullName}`, (octokit) =>
      fetchAuthoredCommits(octokit, source, {
        authorLogin: identity.username,
        authorId: identity.githubUserId,
        since: window.since,
        until: window.until,
        includeFiles,
      }),
    );
    perSource.push({ fullName: source.fullName, branch: source.branch, commitCount: found.length });
    commits.push(...found);
  }

  return { commits, perSource };
}

/**
 * Confirms every selected repository (and branch) is reachable with the user's
 * own GitHub credentials, and that the repository id matches its name — so an
 * automation can only reference repositories the user can actually read.
 */
export async function verifySources(userId: string, sources: AutomationSnapshot["githubSources"]): Promise<void> {
  await requireConnectedIdentity(userId);
  await withGitHub(userId, "verifySources", async (octokit) => {
    for (const source of sources) {
      const repository = await getRepository(octokit, source.owner, source.name);
      if (repository.githubRepositoryId !== source.repositoryId) {
        throw new GitHubApiError("NOT_FOUND", 404, "repository id does not match name");
      }
      if (source.branch) {
        try {
          await octokit.rest.repos.getBranch({ owner: source.owner, repo: source.name, branch: source.branch });
        } catch (error) {
          throw toGitHubApiError(error, "verifySources:getBranch");
        }
      }
    }
  });
}

export function createGitHubPort(userId: string): GitHubPort {
  return {
    fetchCommits: (automation, window) =>
      fetchCommitsForSources(userId, automation.githubSources, window, automation.includeFileStats),
  };
}
