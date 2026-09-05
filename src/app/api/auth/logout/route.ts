import { NextResponse } from "next/server";

import { destroySession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST-only so a cross-site link cannot log the user out. */
export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
