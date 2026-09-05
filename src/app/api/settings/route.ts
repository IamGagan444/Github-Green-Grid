import { NextResponse, type NextRequest } from "next/server";

import { ApiError, handleApiError, readJson, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { revokeOAuthToken } from "@/lib/github/github-client";
import { decryptSecret } from "@/lib/encryption";
import { getEnv } from "@/lib/env";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { destroySession } from "@/lib/session";
import { settingsSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser();

    const limit = await rateLimit(`settings:${user.userId}`, RATE_LIMITS.scheduleWrite);
    if (!limit.success) {
      throw new ApiError("RATE_LIMITED", "Too many updates. Try again shortly.");
    }

    const input = await readJson(request, settingsSchema);
    await prisma.user.update({
      where: { id: user.userId },
      data: {
        defaultTimezone: input.defaultTimezone,
        defaultCommitMessage: input.defaultCommitMessage,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, "api/settings:PATCH");
  }
}

/**
 * Disconnects GitHub: revokes the OAuth grant, deletes every local record for
 * the account, and ends the session. All future scheduled activity stops.
 */
export async function DELETE() {
  try {
    const user = await requireApiUser();

    const account = await prisma.gitHubAccount.findUnique({
      where: { userId: user.userId },
      select: { accessTokenEncrypted: true },
    });

    if (account) {
      const env = getEnv();
      try {
        await revokeOAuthToken(
          decryptSecret(account.accessTokenEncrypted),
          env.GITHUB_CLIENT_ID,
          env.GITHUB_CLIENT_SECRET,
        );
      } catch {
        // Revocation is best effort; local deletion proceeds regardless.
      }
    }

    // Cascades remove sessions, repositories, schedules and executions.
    await prisma.user.delete({ where: { id: user.userId } });
    await destroySession();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, "api/settings:DELETE");
  }
}
