import "server-only";

import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/encryption";
import { ConfigurationError, getAppUrl, getInstagramConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  callGraph,
  getMe,
  getUserProfile,
  listMedia,
  replyToComment,
  sendMessage,
  subscribeApp,
  type MediaPage,
} from "@/lib/instagram/client";
import {
  MAX_ATTEMPTS,
  type InstagramEngineDeps,
  type InstagramEventStore,
  type InstagramPort,
} from "@/lib/instagram/engine";
import { refreshInstagramToken, type InstagramTokenGrant } from "@/lib/instagram/oauth";
import { createLogger } from "@/lib/logging/logger";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { cache, cacheKeys } from "@/lib/cache/cache";
import { recordAudit } from "@/services/audit-service";

const log = createLogger("instagram-service");

/** Long-lived tokens last 60 days; refresh once fewer than this remain. */
export const REFRESH_BEFORE_MS = 10 * 24 * 60 * 60 * 1000;

export function isInstagramConfigured(): boolean {
  try {
    getInstagramConfig();
    return true;
  } catch (error) {
    if (error instanceof ConfigurationError) return false;
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export interface InstagramIntegrationView {
  id: string;
  igUserId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  status: "CONNECTED" | "DISCONNECTED" | "REVOKED";
  webhookSubscribed: boolean;
  tokenExpiresAt: Date | null;
  connectedAt: Date;
}

/** Token-free views of the user's Instagram accounts. */
export async function listInstagramIntegrations(userId: string): Promise<InstagramIntegrationView[]> {
  const rows = await prisma.instagramIntegration.findMany({
    where: { userId },
    select: {
      id: true,
      igUserId: true,
      username: true,
      name: true,
      profilePictureUrl: true,
      status: true,
      webhookSubscribedAt: true,
      tokenExpiresAt: true,
      connectedAt: true,
    },
    orderBy: { connectedAt: "asc" },
  });
  return rows.map(({ webhookSubscribedAt, ...row }) => ({ ...row, webhookSubscribed: webhookSubscribedAt !== null }));
}

export async function connectInstagram(userId: string, grant: InstagramTokenGrant): Promise<string> {
  const profile = await getMe(grant.accessToken);

  const existing = await prisma.instagramIntegration.findUnique({
    where: { igUserId: profile.userId },
    select: { id: true, userId: true, status: true },
  });
  if (existing && existing.userId !== userId) {
    if (existing.status === "CONNECTED") {
      throw new AppError("INSTAGRAM_OAUTH_FAILED", "instagram account connected to another user", {
        userMessage: `@${profile.username} is already connected to another GreenGrid account.`,
      });
    }
    // The previous owner disconnected it; their stale record goes with it.
    await prisma.instagramIntegration.delete({ where: { id: existing.id } });
  }

  const data = {
    appScopedId: profile.appScopedId,
    username: profile.username,
    name: profile.name,
    profilePictureUrl: profile.profilePictureUrl,
    status: "CONNECTED" as const,
    accessTokenEncrypted: encryptSecret(grant.accessToken),
    tokenExpiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000),
    scopes: grant.scopes,
    connectedAt: new Date(),
    disconnectedAt: null,
  };

  const integration = await prisma.instagramIntegration.upsert({
    where: { igUserId: profile.userId },
    create: { ...data, userId, igUserId: profile.userId },
    update: data,
    select: { id: true },
  });

  try {
    await subscribeApp(grant.accessToken);
    await prisma.instagramIntegration.update({
      where: { id: integration.id },
      data: { webhookSubscribedAt: new Date() },
    });
  } catch (error) {
    // Stored anyway; Settings shows the warning and Reconnect retries it.
    log.warn("instagram webhook subscription failed", { integrationId: integration.id, error: error as Error });
  }

  await recordAudit({
    actorUserId: userId,
    action: "INSTAGRAM_CONNECTED",
    targetType: "InstagramIntegration",
    targetId: integration.id,
    metadata: { username: profile.username, scopes: grant.scopes },
  });

  return integration.id;
}

/**
 * Unsubscribes webhooks (best effort), wipes the stored token and marks the
 * account disconnected. Automations and history are kept.
 */
export async function disconnectInstagram(userId: string, integrationId: string): Promise<void> {
  const integration = await prisma.instagramIntegration.findFirst({
    where: { id: integrationId, userId },
    select: { id: true, username: true, accessTokenEncrypted: true },
  });
  if (!integration) throw new AppError("INSTAGRAM_NOT_CONNECTED", "instagram integration not found for user");

  if (integration.accessTokenEncrypted) {
    try {
      await callGraph("me/subscribed_apps", decryptSecret(integration.accessTokenEncrypted), { method: "DELETE" });
    } catch {
      // Best effort.
    }
  }

  await prisma.instagramIntegration.update({
    where: { id: integration.id },
    data: {
      status: "DISCONNECTED",
      accessTokenEncrypted: null,
      tokenExpiresAt: null,
      webhookSubscribedAt: null,
      disconnectedAt: new Date(),
    },
  });

  await recordAudit({
    actorUserId: userId,
    action: "INSTAGRAM_DISCONNECTED",
    targetType: "InstagramIntegration",
    targetId: integration.id,
    metadata: { username: integration.username },
  });
}

/** Deauthorize callback: the person removed the app from their Instagram settings. */
export async function markInstagramRevokedByAppScopedId(appScopedId: string): Promise<number> {
  const rows = await prisma.instagramIntegration.findMany({
    where: { OR: [{ appScopedId }, { igUserId: appScopedId }] },
    select: { id: true, userId: true },
  });
  for (const row of rows) {
    await prisma.instagramIntegration.update({
      where: { id: row.id },
      data: { status: "REVOKED", accessTokenEncrypted: null, webhookSubscribedAt: null, disconnectedAt: new Date() },
    });
    await recordAudit({
      actorUserId: null,
      action: "INSTAGRAM_REVOKED",
      targetType: "InstagramIntegration",
      targetId: row.id,
      metadata: { source: "deauthorize_callback" },
    });
  }
  return rows.length;
}

/** Data-deletion callback: removes the account, its automations and every stored event. */
export async function deleteInstagramDataByAppScopedId(appScopedId: string): Promise<number> {
  const { count } = await prisma.instagramIntegration.deleteMany({
    where: { OR: [{ appScopedId }, { igUserId: appScopedId }] },
  });
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token resolution
// ─────────────────────────────────────────────────────────────────────────────

async function loadConnected(integrationId: string) {
  const integration = await prisma.instagramIntegration.findUnique({ where: { id: integrationId } });
  if (!integration) throw new AppError("INSTAGRAM_NOT_CONNECTED", "instagram integration not found");
  if (integration.status === "REVOKED") throw new AppError("INSTAGRAM_TOKEN_REVOKED", "instagram integration revoked");
  if (integration.status !== "CONNECTED" || !integration.accessTokenEncrypted) {
    throw new AppError("INSTAGRAM_NOT_CONNECTED", "instagram integration disconnected");
  }
  if (integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() < Date.now()) {
    await markRevoked(integration.id);
    throw new AppError("INSTAGRAM_TOKEN_REVOKED", "instagram token expired");
  }
  return integration;
}

function decryptOrRevoked(ciphertext: string): string {
  try {
    return decryptSecret(ciphertext);
  } catch {
    throw new AppError("INSTAGRAM_TOKEN_REVOKED", "stored instagram credential could not be decrypted");
  }
}

async function markRevoked(integrationId: string): Promise<void> {
  await prisma.instagramIntegration.updateMany({
    where: { id: integrationId, status: "CONNECTED" },
    data: { status: "REVOKED" },
  });
  log.warn("instagram integration marked revoked", { integrationId });
}

async function guarded<T>(integrationId: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError && error.code === "INSTAGRAM_TOKEN_REVOKED") await markRevoked(integrationId);
    throw error;
  }
}

/** Refreshes every connected token that expires within `REFRESH_BEFORE_MS`. */
export async function refreshExpiringInstagramTokens(now = new Date()): Promise<{ refreshed: number; failed: number }> {
  const due = await prisma.instagramIntegration.findMany({
    where: {
      status: "CONNECTED",
      accessTokenEncrypted: { not: null },
      tokenExpiresAt: { lt: new Date(now.getTime() + REFRESH_BEFORE_MS) },
      // Instagram rejects refreshing a token younger than 24 hours.
      updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true, accessTokenEncrypted: true },
    take: 50,
  });

  let refreshed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const token = await guarded(row.id, () => refreshInstagramToken(decryptOrRevoked(row.accessTokenEncrypted!)));
      await prisma.instagramIntegration.update({
        where: { id: row.id },
        data: {
          accessTokenEncrypted: encryptSecret(token.accessToken),
          tokenExpiresAt: new Date(Date.now() + token.expiresInSeconds * 1000),
        },
      });
      refreshed += 1;
    } catch (error) {
      failed += 1;
      log.warn("instagram token refresh failed", { integrationId: row.id, error: error as Error });
    }
  }
  return { refreshed, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────

const MEDIA_CACHE_SECONDS = 5 * 60;

/**
 * One page (10) of the account's media for the post picker. Ownership is
 * checked before the cache is consulted; each page is cached per user,
 * account connection and cursor.
 */
export async function listAccountMedia(
  userId: string,
  integrationId: string,
  options: { cursor?: string | null; refresh?: boolean } = {},
): Promise<MediaPage> {
  const integration = await loadConnected(integrationId);
  if (integration.userId !== userId) throw new AppError("INSTAGRAM_NOT_CONNECTED", "instagram integration not owned");
  return cache.getOrSet(
    cacheKeys.user(userId, "ig", integrationId, integration.connectedAt.getTime(), "media", options.cursor ?? "first"),
    MEDIA_CACHE_SECONDS,
    () =>
      guarded(integrationId, () =>
        listMedia(decryptOrRevoked(integration.accessTokenEncrypted!), { after: options.cursor ?? null }),
      ),
    { bypass: options.refresh },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine wiring
// ─────────────────────────────────────────────────────────────────────────────

/** Graph session for one account. The token is decrypted lazily and per call batch. */
export function createInstagramPort(integrationId: string): InstagramPort {
  let token: string | null = null;
  const resolve = async () => {
    if (!token) token = decryptOrRevoked((await loadConnected(integrationId)).accessTokenEncrypted!);
    return token;
  };

  const throttle = async () => {
    const limit = await rateLimit(`instagram:send:${integrationId}`, RATE_LIMITS.instagramSend);
    if (!limit.success) {
      throw new AppError("INSTAGRAM_RATE_LIMITED", "per-account send budget exhausted", {
        retryAfterMs: Math.max((limit.retryAfterSeconds ?? 60) * 1000, 60_000),
      });
    }
  };

  return {
    privateReply: (commentId, message) =>
      guarded(integrationId, async () => {
        await throttle();
        return sendMessage(await resolve(), { comment_id: commentId }, message);
      }),
    sendDirect: (igsid, message) =>
      guarded(integrationId, async () => {
        await throttle();
        return sendMessage(await resolve(), { id: igsid }, message);
      }),
    replyToComment: (commentId, text) =>
      guarded(integrationId, async () => replyToComment(await resolve(), commentId, text)),
    followsBusiness: (igsid) =>
      guarded(integrationId, async () => (await getUserProfile(await resolve(), igsid)).followsBusiness),
  };
}

export function trackedLinkUrl(originEventId: string, linkUrl: string | null): string | null {
  return linkUrl ? `${getAppUrl()}/r/ig/${originEventId}` : null;
}

export const instagramEventStore: InstagramEventStore = {
  async claim(eventId, leaseMs) {
    const now = new Date();
    const { count } = await prisma.instagramEvent.updateMany({
      where: {
        id: eventId,
        status: "RUNNING",
        attempt: { lt: MAX_ATTEMPTS },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        AND: [{ OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] }],
      },
      data: { leaseExpiresAt: new Date(now.getTime() + leaseMs), attempt: { increment: 1 } },
    });
    if (count === 0) return null;

    const row = await prisma.instagramEvent.findUniqueOrThrow({
      where: { id: eventId },
      include: { automation: true },
    });
    const automation = row.automation;
    return {
      id: row.id,
      type: row.type,
      sourceId: row.sourceId,
      senderIgsid: row.senderIgsid,
      text: row.text,
      occurredAt: row.occurredAt,
      attempt: row.attempt,
      publicReplyStatus: row.publicReplyStatus,
      dmStatus: row.dmStatus,
      linkStatus: row.linkStatus,
      automation: automation
        ? {
            id: automation.id,
            active: automation.status === "ACTIVE",
            publicReplyEnabled: automation.publicReplyEnabled,
            publicReplies: automation.publicReplies,
            dmMessage: automation.dmMessage,
            linkUrl: automation.linkUrl,
            linkButtonLabel: automation.linkButtonLabel,
            followGateEnabled: automation.followGateEnabled,
            followGateMessage: automation.followGateMessage,
            followButtonLabel: automation.followButtonLabel,
          }
        : null,
    };
  },

  async saveStep(eventId, patch) {
    await prisma.instagramEvent.update({ where: { id: eventId }, data: patch });
  },

  async finish(eventId, status, error) {
    await prisma.instagramEvent.update({
      where: { id: eventId },
      data: {
        status,
        leaseExpiresAt: null,
        nextRetryAt: null,
        finishedAt: new Date(),
        errorCode: error?.code ?? null,
        errorMessage: error ? error.userMessage : null,
      },
    });
  },

  async scheduleRetry(eventId, at, error) {
    await prisma.instagramEvent.update({
      where: { id: eventId },
      data: { leaseExpiresAt: null, nextRetryAt: at, errorCode: error.code, errorMessage: error.userMessage },
    });
  },

  async markLinkDelivered(originEventId) {
    await prisma.instagramEvent.updateMany({ where: { id: originEventId }, data: { linkStatus: "SUCCESS" } });
  },

  async incrementSent(automationId) {
    await prisma.instagramAutomation.updateMany({ where: { id: automationId }, data: { sentCount: { increment: 1 } } });
  },
};

export function createEngineDeps(integrationId: string): InstagramEngineDeps {
  return { store: instagramEventStore, port: createInstagramPort(integrationId), trackedUrl: trackedLinkUrl };
}
