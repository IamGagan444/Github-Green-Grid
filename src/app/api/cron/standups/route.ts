import { NextResponse, type NextRequest } from "next/server";

import { pruneExpiredSessions } from "@/lib/auth/maintenance";
import { createLogger } from "@/lib/logging/logger";
import { isCronAuthorised } from "@/lib/scheduler/cron-auth";
import { processDueAutomations } from "@/lib/scheduler/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const log = createLogger("cron-standups");

/**
 * Standup scheduler tick. Call every 5–15 minutes with
 * `Authorization: Bearer $CRON_SECRET`. Safe to call concurrently or
 * repeatedly: executions are idempotent per automation per local day.
 */
export async function POST(request: NextRequest) {
  if (!isCronAuthorised(request.headers)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid cron credentials." } },
      { status: 401 },
    );
  }

  try {
    const summary = await processDueAutomations();
    await pruneExpiredSessions().catch(() => 0);
    log.info("scheduler tick complete", { ...summary });
    return NextResponse.json(summary);
  } catch (error) {
    log.error("scheduler tick failed", { error: error as Error });
    return NextResponse.json(
      { error: { code: "CRON_FAILURE", message: "The scheduler could not complete this batch." } },
      { status: 500 },
    );
  }
}

/** Vercel Cron issues GET requests; it shares the POST implementation. */
export async function GET(request: NextRequest) {
  return POST(request);
}
