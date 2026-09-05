import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { encryptSecret, safeCompare } from "@/lib/encryption";
import { getAppUrl, getEnv } from "@/lib/env";
import { exchangeOAuthCode } from "@/lib/github/github-client";
import { fetchProfileWithToken } from "@/lib/github/github-user";
import { getRedirectUri, sanitiseReturnTo } from "@/lib/github/oauth";
import { consumeOAuthStateCookie, createSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function loginRedirect(reason: string): NextResponse {
  return NextResponse.redirect(`${getAppUrl()}/login?error=${reason}`);
}

/**
 * Completes the OAuth flow: validates state (CSRF), exchanges the code,
 * upserts the account with an encrypted token, and opens a server session.
 */
export async function GET(request: NextRequest) {
  const { state: expectedState, returnTo } = await consumeOAuthStateCookie();

  const code = request.nextUrl.searchParams.get("code");
  const receivedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) return loginRedirect("access_denied");
  if (!code || !receivedState) return loginRedirect("invalid_request");
  if (!expectedState || !safeCompare(expectedState, receivedState)) {
    return loginRedirect("invalid_state");
  }

  try {
    const env = getEnv();
    const { accessToken, scopes, expiresInSeconds } = await exchangeOAuthCode(
      code,
      env.GITHUB_CLIENT_ID,
      env.GITHUB_CLIENT_SECRET,
      getRedirectUri(),
    );

    const profile = await fetchProfileWithToken(accessToken);

    const accountData = {
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
      accessTokenEncrypted: encryptSecret(accessToken),
      scopes,
      tokenExpiresAt: expiresInSeconds
        ? new Date(Date.now() + expiresInSeconds * 1000)
        : null,
    };

    const existing = await prisma.gitHubAccount.findUnique({
      where: { githubUserId: profile.githubUserId },
      select: { userId: true },
    });

    const userId = existing
      ? existing.userId
      : (await prisma.user.create({ data: {}, select: { id: true } })).id;

    await prisma.gitHubAccount.upsert({
      where: { githubUserId: profile.githubUserId },
      create: { ...accountData, githubUserId: profile.githubUserId, userId },
      update: accountData,
    });

    await createSession(userId, request.headers.get("user-agent") ?? undefined);

    return NextResponse.redirect(`${getAppUrl()}${sanitiseReturnTo(returnTo)}`);
  } catch (error) {
    console.error("[auth/callback] GitHub sign-in failed", error);
    return loginRedirect("connection_failed");
  }
}
