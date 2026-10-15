import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging/logger";
import { isCronAuthorised } from "@/lib/scheduler/cron-auth";
import { processDueInstagramEvents } from "@/services/instagram-event-service";
import { refreshExpiringInstagramTokens } from "@/services/instagram-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const log = createLogger("cron-instagram");

const BUDGET_MS = 45_000;

/**
 * Instagram maintenance tick: retries failed sends that are due, finishes
 * events the webhook could not, and refreshes long-lived tokens before they
 * expire. Call every 5–15 minutes with `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(request: NextRequest) {
  if (!isCronAuthorised(request.headers)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid cron credentials." } },
      { status: 401 },
    );
  }

  const run = await prisma.cronRun.create({ data: { job: "instagram" }, select: { id: true } });
  try {
    const events = await processDueInstagramEvents(Date.now() + BUDGET_MS);
    const tokens = await refreshExpiringInstagramTokens();
    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        processed: events.SUCCESS + events.FAILED + events.SKIPPED + events.RETRY,
        succeeded: events.SUCCESS,
        failed: events.FAILED,
        skipped: events.SKIPPED,
      },
    });
    const summary = { events, tokens };
    log.info("instagram tick complete", { ...events, refreshed: tokens.refreshed, refreshFailed: tokens.failed });
    return NextResponse.json(summary);
  } catch (error) {
    log.error("instagram tick failed", { error: error as Error });
    await prisma.cronRun
      .update({ where: { id: run.id }, data: { finishedAt: new Date(), error: "CRON_FAILURE" } })
      .catch(() => undefined);
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
