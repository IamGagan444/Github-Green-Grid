import "server-only";

import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/encryption";
import { AppError } from "@/lib/errors";
import { appendRow, createSpreadsheet, sendGmail } from "@/lib/google/client";
import type { MimeInput } from "@/lib/google/mime";
import {
  fetchGoogleProfile,
  GMAIL_SEND_SCOPE,
  refreshGoogleToken,
  revokeGoogleToken,
  SHEETS_SCOPE,
  type GoogleTokenGrant,
} from "@/lib/google/oauth";
import { createLogger } from "@/lib/logging/logger";
import { recordAudit } from "@/services/audit-service";

const log = createLogger("google-service");

/** Refresh slightly early so a token cannot lapse mid-request. */
const EXPIRY_SKEW_MS = 5 * 60_000;

export interface GoogleIntegrationView {
  connected: boolean;
  status: "CONNECTED" | "DISCONNECTED" | "REVOKED" | "NOT_CONNECTED";
  email: string | null;
  canSendEmail: boolean;
  canCreateSheets: boolean;
  connectedAt: Date | null;
}

export async function getGoogleIntegration(userId: string): Promise<GoogleIntegrationView> {
  const row = await prisma.googleIntegration.findUnique({
    where: { userId },
    select: { status: true, email: true, scopes: true, connectedAt: true },
  });
  if (!row) {
    return { connected: false, status: "NOT_CONNECTED", email: null, canSendEmail: false, canCreateSheets: false, connectedAt: null };
  }
  const connected = row.status === "CONNECTED";
  return {
    connected,
    status: row.status,
    email: row.email,
    canSendEmail: connected && row.scopes.includes(GMAIL_SEND_SCOPE),
    canCreateSheets: connected && row.scopes.includes(SHEETS_SCOPE),
    connectedAt: row.connectedAt,
  };
}

export async function connectGoogle(userId: string, grant: GoogleTokenGrant): Promise<void> {
  const profile = await fetchGoogleProfile(grant.accessToken);
  const existing = await prisma.googleIntegration.findUnique({ where: { userId }, select: { refreshTokenEncrypted: true } });

  // Google only returns a refresh token on consent; keep the stored one otherwise.
  const refreshTokenEncrypted = grant.refreshToken
    ? encryptSecret(grant.refreshToken)
    : (existing?.refreshTokenEncrypted ?? null);
  if (!refreshTokenEncrypted) {
    throw new AppError("GOOGLE_OAUTH_FAILED", "google returned no refresh token", {
      userMessage: "Google did not grant offline access. Remove GreenGrid at myaccount.google.com/permissions, then connect again.",
    });
  }

  const data = {
    googleSub: profile.sub,
    email: profile.email,
    status: "CONNECTED" as const,
    refreshTokenEncrypted,
    accessTokenEncrypted: encryptSecret(grant.accessToken),
    tokenExpiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000),
    scopes: grant.scopes,
    connectedAt: new Date(),
    disconnectedAt: null,
  };
  await prisma.googleIntegration.upsert({ where: { userId }, create: { ...data, userId }, update: data });

  await recordAudit({
    actorUserId: userId,
    action: "GOOGLE_CONNECTED",
    targetType: "GoogleIntegration",
    metadata: { email: profile.email, scopes: grant.scopes },
  });
}

export async function disconnectGoogle(userId: string): Promise<void> {
  const row = await prisma.googleIntegration.findUnique({ where: { userId }, select: { id: true, refreshTokenEncrypted: true } });
  if (!row) throw new AppError("GOOGLE_NOT_CONNECTED", "no google integration");
  if (row.refreshTokenEncrypted) {
    try {
      await revokeGoogleToken(decryptSecret(row.refreshTokenEncrypted));
    } catch {
      // Best effort.
    }
  }
  await prisma.googleIntegration.update({
    where: { id: row.id },
    data: {
      status: "DISCONNECTED",
      refreshTokenEncrypted: null,
      accessTokenEncrypted: null,
      tokenExpiresAt: null,
      disconnectedAt: new Date(),
    },
  });
  await recordAudit({ actorUserId: userId, action: "GOOGLE_DISCONNECTED", targetType: "GoogleIntegration", targetId: row.id });
}

async function markRevoked(userId: string): Promise<void> {
  const { count } = await prisma.googleIntegration.updateMany({
    where: { userId, status: "CONNECTED" },
    data: { status: "REVOKED", accessTokenEncrypted: null },
  });
  if (count > 0) {
    log.warn("google integration marked revoked", { userId });
    await recordAudit({ actorUserId: null, action: "GOOGLE_REVOKED", targetType: "GoogleIntegration", metadata: { userId } });
  }
}

function decryptOrRevoked(ciphertext: string): string {
  try {
    return decryptSecret(ciphertext);
  } catch {
    throw new AppError("GOOGLE_TOKEN_REVOKED", "stored google credential could not be decrypted");
  }
}

/** A valid access token, refreshed when it is about to expire. */
async function accessToken(userId: string, requiredScope: string): Promise<{ token: string; email: string }> {
  const row = await prisma.googleIntegration.findUnique({ where: { userId } });
  if (!row || row.status === "DISCONNECTED") throw new AppError("GOOGLE_NOT_CONNECTED", "google not connected");
  if (row.status === "REVOKED" || !row.refreshTokenEncrypted) throw new AppError("GOOGLE_TOKEN_REVOKED", "google revoked");
  if (!row.scopes.includes(requiredScope)) {
    throw new AppError("GOOGLE_PERMISSION_DENIED", `google scope ${requiredScope} not granted`);
  }

  const fresh = row.accessTokenEncrypted && row.tokenExpiresAt && row.tokenExpiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();
  if (fresh) return { token: decryptOrRevoked(row.accessTokenEncrypted!), email: row.email };

  let grant: GoogleTokenGrant;
  try {
    grant = await refreshGoogleToken(decryptOrRevoked(row.refreshTokenEncrypted));
  } catch (error) {
    if (error instanceof AppError && error.code === "GOOGLE_TOKEN_REVOKED") await markRevoked(userId);
    throw error;
  }
  // Concurrent refreshes are harmless: Google keeps every issued access token valid until expiry.
  await prisma.googleIntegration.update({
    where: { id: row.id },
    data: {
      accessTokenEncrypted: encryptSecret(grant.accessToken),
      tokenExpiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000),
      ...(grant.refreshToken ? { refreshTokenEncrypted: encryptSecret(grant.refreshToken) } : {}),
    },
  });
  return { token: grant.accessToken, email: row.email };
}

async function guarded<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError && error.code === "GOOGLE_TOKEN_REVOKED") await markRevoked(userId);
    throw error;
  }
}

export interface GooglePort {
  createSpreadsheet(title: string, headers: string[]): Promise<{ spreadsheetId: string; url: string }>;
  appendRow(spreadsheetId: string, values: string[]): Promise<{ updatedRange: string | null }>;
  sendEmail(input: { to: string; subject: string; html: string; text: string; replyTo?: string | null; fromName?: string | null }): Promise<{ messageId: string }>;
}

export function createGooglePort(userId: string): GooglePort {
  return {
    createSpreadsheet: (title, headers) =>
      guarded(userId, async () => createSpreadsheet((await accessToken(userId, SHEETS_SCOPE)).token, title, headers)),
    appendRow: (spreadsheetId, values) =>
      guarded(userId, async () => appendRow((await accessToken(userId, SHEETS_SCOPE)).token, spreadsheetId, values)),
    sendEmail: (input) =>
      guarded(userId, async () => {
        const { token, email } = await accessToken(userId, GMAIL_SEND_SCOPE);
        const message: MimeInput = {
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
          replyTo: input.replyTo ?? null,
          from: input.fromName ? { name: input.fromName, address: email } : null,
        };
        return sendGmail(token, message);
      }),
  };
}
