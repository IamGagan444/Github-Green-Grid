import "server-only";

import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/encryption";
import { AppError } from "@/lib/errors";
import type { LinkedInGrant } from "@/lib/linkedin/client";
import { recordAudit } from "@/services/audit-service";

/** Tokens this close to expiry are treated as expired (a post must not start with a dying token). */
const EXPIRY_MARGIN_MS = 10 * 60_000;

export interface LinkedInView {
  connected: boolean;
  status: "CONNECTED" | "DISCONNECTED" | "REVOKED" | "NOT_CONNECTED";
  name: string | null;
  canPost: boolean;
  expiresAt: Date | null;
}

export async function getLinkedInIntegration(userId: string): Promise<LinkedInView> {
  const row = await prisma.linkedInIntegration.findUnique({
    where: { userId },
    select: { status: true, name: true, scopes: true, tokenExpiresAt: true },
  });
  if (!row) return { connected: false, status: "NOT_CONNECTED", name: null, canPost: false, expiresAt: null };
  const live = row.status === "CONNECTED" && (!row.tokenExpiresAt || row.tokenExpiresAt.getTime() > Date.now() + EXPIRY_MARGIN_MS);
  return {
    connected: live,
    status: live ? "CONNECTED" : row.status === "CONNECTED" ? "REVOKED" : row.status,
    name: row.name,
    canPost: live && row.scopes.includes("w_member_social"),
    expiresAt: row.tokenExpiresAt,
  };
}

export async function connectLinkedIn(userId: string, grant: LinkedInGrant, profile: { sub: string; name: string | null }): Promise<void> {
  const data = {
    memberSub: profile.sub,
    name: profile.name,
    status: "CONNECTED" as const,
    accessTokenEncrypted: encryptSecret(grant.accessToken),
    tokenExpiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000),
    expiryWarnedAt: null,
    scopes: grant.scopes,
    connectedAt: new Date(),
    disconnectedAt: null,
  };
  const row = await prisma.linkedInIntegration.upsert({ where: { userId }, create: { ...data, userId }, update: data, select: { id: true } });
  await recordAudit({ actorUserId: userId, action: "LINKEDIN_CONNECTED", targetType: "LinkedInIntegration", targetId: row.id });
}

export async function disconnectLinkedIn(userId: string): Promise<void> {
  const row = await prisma.linkedInIntegration.findUnique({ where: { userId }, select: { id: true } });
  if (!row) return;
  await prisma.linkedInIntegration.update({
    where: { id: row.id },
    data: { status: "DISCONNECTED", accessTokenEncrypted: null, tokenExpiresAt: null, disconnectedAt: new Date() },
  });
  await recordAudit({ actorUserId: userId, action: "LINKEDIN_DISCONNECTED", targetType: "LinkedInIntegration", targetId: row.id });
}

/** Marks the connection unusable after LinkedIn rejected the token. */
export async function markLinkedInRevoked(userId: string): Promise<void> {
  const { count } = await prisma.linkedInIntegration.updateMany({ where: { userId, status: "CONNECTED" }, data: { status: "REVOKED", accessTokenEncrypted: null } });
  if (count > 0) await recordAudit({ actorUserId: userId, action: "LINKEDIN_REVOKED", targetType: "LinkedInIntegration", targetId: userId });
}

/** The member's token and id, or an error saying how to fix it. */
export async function getLinkedInCredentials(userId: string): Promise<{ accessToken: string; memberSub: string }> {
  const row = await prisma.linkedInIntegration.findUnique({
    where: { userId },
    select: { status: true, memberSub: true, accessTokenEncrypted: true, tokenExpiresAt: true },
  });
  if (!row || row.status === "DISCONNECTED" || !row.accessTokenEncrypted) throw new AppError("LINKEDIN_NOT_CONNECTED", "linkedin not connected");
  if (row.status === "REVOKED" || (row.tokenExpiresAt && row.tokenExpiresAt.getTime() <= Date.now() + EXPIRY_MARGIN_MS)) {
    throw new AppError("LINKEDIN_TOKEN_REVOKED", "linkedin token expired or revoked");
  }
  return { accessToken: decryptSecret(row.accessTokenEncrypted), memberSub: row.memberSub };
}
