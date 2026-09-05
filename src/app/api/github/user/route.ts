import { NextResponse } from "next/server";

import { handleApiError, requireApiUser } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public profile fields for the signed-in GitHub account. No credentials. */
export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({
      user: {
        githubUserId: user.githubUserId,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        email: user.email,
      },
    });
  } catch (error) {
    return handleApiError(error, "api/github/user");
  }
}
