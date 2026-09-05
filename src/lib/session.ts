import { cookies } from "next/headers";
import { cache } from "react";
import "server-only";

import { prisma } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/encryption";
import { isProduction } from "@/lib/env";

export const SESSION_COOKIE = "greengrid_session";
export const OAUTH_STATE_COOKIE = "greengrid_oauth_state";
export const OAUTH_RETURN_COOKIE = "greengrid_oauth_return";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface SessionUser {
  userId: string;
  githubUserId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Creates a DB-backed session and sets the opaque token cookie. */
export async function createSession(userId: string, userAgent?: string): Promise<void> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 255) ?? null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_MS / 1000));
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  store.set(SESSION_COOKIE, "", cookieOptions(0));
}

/**
 * Resolves the current session user. Cached per-request so multiple server
 * components can call it without extra queries.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { githubAccount: true } } },
  });

  if (!session || session.expiresAt.getTime() < Date.now()) return null;

  const account = session.user.githubAccount;
  if (!account) return null;

  return {
    userId: session.userId,
    githubUserId: account.githubUserId,
    username: account.username,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    email: account.email,
  };
});

export async function setOAuthStateCookie(state: string, returnTo: string): Promise<void> {
  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, state, cookieOptions(600));
  store.set(OAUTH_RETURN_COOKIE, returnTo, cookieOptions(600));
}

export async function consumeOAuthStateCookie(): Promise<{
  state: string | null;
  returnTo: string;
}> {
  const store = await cookies();
  const state = store.get(OAUTH_STATE_COOKIE)?.value ?? null;
  const returnTo = store.get(OAUTH_RETURN_COOKIE)?.value ?? "/dashboard";

  store.set(OAUTH_STATE_COOKIE, "", cookieOptions(0));
  store.set(OAUTH_RETURN_COOKIE, "", cookieOptions(0));

  return { state, returnTo };
}

/** Removes expired sessions. Called opportunistically from the cron endpoint. */
export async function pruneExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
