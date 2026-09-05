import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns the current session's public profile fields.
 * Deliberately excludes anything credential-shaped.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
  });
}
