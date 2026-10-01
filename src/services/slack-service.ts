import "server-only";

import { cached } from "@/lib/cache/redis";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/encryption";
import { ConfigurationError, getSlackConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logging/logger";
import {
  authTest,
  channelHistory,
  getChannel,
  getPermalink,
  joinChannel,
  listChannels,
  postMessage,
  revokeToken,
  threadReplies,
} from "@/lib/slack/client";
import { isTokenExpiredError } from "@/lib/slack/errors";
import { refreshSlackToken, type SlackTokenGrant } from "@/lib/slack/oauth";
import type { SlackChannel } from "@/lib/slack/types";
import type { SlackPort } from "@/lib/automation/types";
import type { SlackPostingMode } from "@/generated/prisma/enums";
import { recordAudit } from "@/services/audit-service";

const log = createLogger("slack-service");
const EXPIRY_SKEW_MS = 5 * 60_000;

export interface SlackIntegrationView {
  id: string;
  teamId: string;
  teamName: string;
  teamDomain: string | null;
  authedUserId: string;
  status: "CONNECTED" | "DISCONNECTED" | "REVOKED";
  /** True when "Post as me" is available for this workspace. */
  userPostingAvailable: boolean;
  connectedAt: Date;
}

const viewSelect = {
  id: true,
  teamId: true,
  teamName: true,
  teamDomain: true,
  authedUserId: true,
  status: true,
  userTokenEncrypted: true,
  userScopes: true,
  connectedAt: true,
} as const;

function toView(row: {
  id: string;
  teamId: string;
  teamName: string;
  teamDomain: string | null;
  authedUserId: string;
  status: "CONNECTED" | "DISCONNECTED" | "REVOKED";
  userTokenEncrypted: string | null;
  userScopes: string[];
  connectedAt: Date;
}): SlackIntegrationView {
  return {
    id: row.id,
    teamId: row.teamId,
    teamName: row.teamName,
    teamDomain: row.teamDomain,
    authedUserId: row.authedUserId,
    status: row.status,
    userPostingAvailable: Boolean(row.userTokenEncrypted) && row.userScopes.includes("chat:write"),
    connectedAt: row.connectedAt,
  };
}

/** Token-free views of the user's Slack workspaces. */
export async function listSlackIntegrations(userId: string): Promise<SlackIntegrationView[]> {
  const rows = await prisma.slackIntegration.findMany({
    where: { userId },
    select: viewSelect,
    orderBy: { connectedAt: "asc" },
  });
  return rows.map(toView);
}

export function isSlackConfigured(): boolean {
  try {
    getSlackConfig();
    return true;
  } catch (error) {
    if (error instanceof ConfigurationError) return false;
    throw error;
  }
}

export function isUserPostingOffered(): boolean {
  try {
    return getSlackConfig().userScopes.length > 0;
  } catch {
    return false;
  }
}

export async function connectSlack(userId: string, grant: SlackTokenGrant): Promise<string> {
  if (!grant.bot) throw new AppError("SLACK_OAUTH_FAILED", "missing bot token");

  // Confirm the token works and learn the workspace URL.
  const identity = await authTest(grant.bot.accessToken);
  const teamDomain = identity.url ? new URL(identity.url).hostname.split(".")[0] ?? null : null;

  const data = {
    teamName: grant.teamName,
    teamDomain,
    appId: grant.appId,
    authedUserId: grant.authedUserId,
    botUserId: grant.botUserId,
    status: "CONNECTED" as const,
    botTokenEncrypted: encryptSecret(grant.bot.accessToken),
    botRefreshTokenEncrypted: grant.bot.refreshToken ? encryptSecret(grant.bot.refreshToken) : null,
    botTokenExpiresAt: grant.bot.expiresInSeconds ? new Date(Date.now() + grant.bot.expiresInSeconds * 1000) : null,
    botScopes: grant.bot.scopes,
    userTokenEncrypted: grant.user ? encryptSecret(grant.user.accessToken) : null,
    userRefreshTokenEncrypted: grant.user?.refreshToken ? encryptSecret(grant.user.refreshToken) : null,
    userTokenExpiresAt: grant.user?.expiresInSeconds
      ? new Date(Date.now() + grant.user.expiresInSeconds * 1000)
      : null,
    userScopes: grant.user?.scopes ?? [],
    connectedAt: new Date(),
    disconnectedAt: null,
  };

  const integration = await prisma.slackIntegration.upsert({
    where: { userId_teamId: { userId, teamId: grant.teamId } },
    create: { ...data, userId, teamId: grant.teamId },
    update: data,
    select: { id: true },
  });

  await recordAudit({
    actorUserId: userId,
    action: "SLACK_CONNECTED",
    targetType: "SlackIntegration",
    targetId: integration.id,
    metadata: { teamId: grant.teamId, teamName: grant.teamName, userPosting: Boolean(grant.user) },
  });

  return integration.id;
}

/**
 * Revokes tokens at Slack (best effort), wipes stored credentials and marks the
 * workspace disconnected. Automations keep their configuration and history but
 * cannot execute until the workspace is reconnected.
 */
export async function disconnectSlack(userId: string, integrationId: string): Promise<void> {
  const integration = await prisma.slackIntegration.findFirst({
    where: { id: integrationId, userId },
    select: { id: true, teamId: true, botTokenEncrypted: true, userTokenEncrypted: true },
  });
  if (!integration) throw new AppError("SLACK_NOT_CONNECTED", "slack integration not found for user");

  for (const encrypted of [integration.userTokenEncrypted, integration.botTokenEncrypted]) {
    if (!encrypted) continue;
    try {
      await revokeToken(decryptSecret(encrypted));
    } catch {
      // Best effort.
    }
  }

  await prisma.slackIntegration.update({
    where: { id: integration.id },
    data: {
      status: "DISCONNECTED",
      botTokenEncrypted: null,
      botRefreshTokenEncrypted: null,
      botTokenExpiresAt: null,
      userTokenEncrypted: null,
      userRefreshTokenEncrypted: null,
      userTokenExpiresAt: null,
      disconnectedAt: new Date(),
    },
  });

  await recordAudit({
    actorUserId: userId,
    action: "SLACK_DISCONNECTED",
    targetType: "SlackIntegration",
    targetId: integration.id,
    metadata: { teamId: integration.teamId },
  });
}

/** Handles `app_uninstalled` / `tokens_revoked` events from Slack. */
export async function markWorkspaceRevoked(teamId: string, scope: "all" | "user", slackUserIds: string[] = []) {
  if (scope === "all") {
    const { count } = await prisma.slackIntegration.updateMany({
      where: { teamId, status: "CONNECTED" },
      data: {
        status: "REVOKED",
        botTokenEncrypted: null,
        botRefreshTokenEncrypted: null,
        userTokenEncrypted: null,
        userRefreshTokenEncrypted: null,
        disconnectedAt: new Date(),
      },
    });
    return count;
  }
  const { count } = await prisma.slackIntegration.updateMany({
    where: { teamId, authedUserId: { in: slackUserIds } },
    data: { userTokenEncrypted: null, userRefreshTokenEncrypted: null, userScopes: [] },
  });
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token resolution
// ─────────────────────────────────────────────────────────────────────────────

type TokenKind = "bot" | "user";

async function loadIntegration(integrationId: string, userId: string) {
  const integration = await prisma.slackIntegration.findFirst({ where: { id: integrationId, userId } });
  if (!integration) throw new AppError("SLACK_NOT_CONNECTED", "slack integration not found");
  if (integration.status === "REVOKED") throw new AppError("SLACK_TOKEN_REVOKED", "slack integration revoked");
  if (integration.status !== "CONNECTED") throw new AppError("SLACK_NOT_CONNECTED", "slack integration disconnected");
  return integration;
}

/**
 * Decrypts the token for `kind`, refreshing it first when Slack token rotation
 * is enabled and the token is about to expire. The plaintext never leaves the
 * server process.
 */
async function resolveToken(integrationId: string, userId: string, kind: TokenKind): Promise<string> {
  const integration = await loadIntegration(integrationId, userId);
  const encrypted = kind === "bot" ? integration.botTokenEncrypted : integration.userTokenEncrypted;
  const refreshEncrypted = kind === "bot" ? integration.botRefreshTokenEncrypted : integration.userRefreshTokenEncrypted;
  const expiresAt = kind === "bot" ? integration.botTokenExpiresAt : integration.userTokenExpiresAt;

  if (!encrypted) {
    if (kind === "user") throw new AppError("SLACK_USER_POSTING_UNAVAILABLE", "no user token stored");
    throw new AppError("SLACK_NOT_CONNECTED", "no bot token stored");
  }

  const expiring = expiresAt !== null && expiresAt.getTime() - EXPIRY_SKEW_MS < Date.now();
  if (!expiring) return decryptOrRevoked(encrypted);

  if (!refreshEncrypted) throw new AppError("SLACK_TOKEN_REVOKED", "slack token expired without refresh token");
  const refreshed = await refreshSlackToken(decryptOrRevoked(refreshEncrypted));

  await prisma.slackIntegration.update({
    where: { id: integration.id },
    data:
      kind === "bot"
        ? {
            botTokenEncrypted: encryptSecret(refreshed.accessToken),
            botRefreshTokenEncrypted: refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : null,
            botTokenExpiresAt: refreshed.expiresInSeconds
              ? new Date(Date.now() + refreshed.expiresInSeconds * 1000)
              : null,
          }
        : {
            userTokenEncrypted: encryptSecret(refreshed.accessToken),
            userRefreshTokenEncrypted: refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : null,
            userTokenExpiresAt: refreshed.expiresInSeconds
              ? new Date(Date.now() + refreshed.expiresInSeconds * 1000)
              : null,
          },
  });
  return refreshed.accessToken;
}

function decryptOrRevoked(ciphertext: string): string {
  try {
    return decryptSecret(ciphertext);
  } catch {
    throw new AppError("SLACK_TOKEN_REVOKED", "stored slack credential could not be decrypted");
  }
}

async function markRevoked(integrationId: string): Promise<void> {
  await prisma.slackIntegration.updateMany({
    where: { id: integrationId, status: "CONNECTED" },
    data: { status: "REVOKED" },
  });
  log.warn("slack integration marked revoked", { integrationId });
}

/** Wraps a Slack call so a revoked token flips the integration to REVOKED. */
async function guarded<T>(integrationId: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError && error.code === "SLACK_TOKEN_REVOKED" && !isTokenExpiredError(error)) {
      await markRevoked(integrationId);
    }
    throw error;
  }
}

function tokenKindFor(mode: SlackPostingMode): TokenKind {
  return mode === "USER" ? "user" : "bot";
}

// ─────────────────────────────────────────────────────────────────────────────
// Operations used by the UI
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL_CACHE_SECONDS = 5 * 60;

export async function listWorkspaceChannels(
  userId: string,
  integrationId: string,
  mode: SlackPostingMode,
  options: { refresh?: boolean } = {},
): Promise<SlackChannel[]> {
  // Ownership and status are checked before the cache is consulted; the key
  // includes the connection time so a reinstall starts clean.
  const integration = await loadIntegration(integrationId, userId);
  return cached(
    `slack:${userId}:${integrationId}:${integration.connectedAt.getTime()}:channels:${mode}`,
    CHANNEL_CACHE_SECONDS,
    () =>
      guarded(integrationId, async () => {
        const token = await resolveToken(integrationId, userId, tokenKindFor(mode));
        return listChannels(token);
      }),
    { bypass: options.refresh },
  );
}

/**
 * Makes sure the posting identity can post in the channel. In bot mode a
 * public channel is joined automatically; a private channel requires the bot to
 * be invited (`/invite @app`), which cannot be done on the user's behalf.
 */
async function ensureChannelAccess(token: string, channelId: string, mode: SlackPostingMode) {
  const channel = await getChannel(token, channelId);
  if (channel.isMember) return channel;

  if (mode === "BOT" && !channel.isPrivate) {
    await joinChannel(token, channelId);
    return { ...channel, isMember: true };
  }

  throw new AppError(
    "SLACK_CHANNEL_UNAVAILABLE",
    "posting identity is not a member of the channel",
    {
      userMessage:
        mode === "BOT"
          ? `Invite the app to #${channel.name} in Slack (/invite), then try again.`
          : `You are not a member of #${channel.name}.`,
    },
  );
}

export async function checkChannelAccess(
  userId: string,
  integrationId: string,
  channelId: string,
  mode: SlackPostingMode,
): Promise<SlackChannel> {
  return guarded(integrationId, async () => {
    const token = await resolveToken(integrationId, userId, tokenKindFor(mode));
    return ensureChannelAccess(token, channelId, mode);
  });
}

/**
 * A Slack session for one execution. Tokens are resolved lazily so a missing
 * integration is recorded as an execution failure rather than thrown early.
 */
export function createSlackPort(
  userId: string,
  integrationId: string | null,
  mode: SlackPostingMode,
): SlackPort {
  let cachedToken: string | null = null;
  let cachedTeamId: string | null = null;

  const requireId = () => {
    if (!integrationId) throw new AppError("SLACK_NOT_CONNECTED", "automation has no slack integration");
    return integrationId;
  };

  const token = async () => {
    if (!cachedToken) cachedToken = await resolveToken(requireId(), userId, tokenKindFor(mode));
    return cachedToken;
  };

  return {
    async teamId() {
      if (!cachedTeamId) {
        const integration = await loadIntegration(requireId(), userId);
        cachedTeamId = integration.teamId;
      }
      return cachedTeamId;
    },
    prepareChannel: (channelId) =>
      guarded(requireId(), async () => {
        const channel = await ensureChannelAccess(await token(), channelId, mode);
        return { name: channel.name };
      }),
    history: (channelId, oldest) => guarded(requireId(), async () => channelHistory(await token(), channelId, oldest)),
    replies: (channelId, parentTs) =>
      guarded(requireId(), async () => threadReplies(await token(), channelId, parentTs)),
    post: (input) =>
      guarded(requireId(), async () =>
        postMessage(await token(), {
          channel: input.channel,
          text: input.text,
          threadTs: input.threadTs,
          metadata: input.metadata,
        }),
      ),
    permalink: async (channelId, ts) => getPermalink(await token(), channelId, ts),
  };
}
