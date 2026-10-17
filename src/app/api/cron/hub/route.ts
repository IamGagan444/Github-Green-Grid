import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging/logger";
import { continueIfBacklogged } from "@/lib/scheduler/continuation";
import { isCronAuthorised } from "@/lib/scheduler/cron-auth";
import { pollDueCrossPosts } from "@/services/crosspost-service";
import { runDueDigests } from "@/services/digest-service";
import { sweepUnfannedEvents } from "@/services/notification-service";
import { runDueReminders } from "@/services/reminder-service";
import { runDueChecks } from "@/services/uptime-service";
import "@/services/workflow-handlers";
import { drainDueRuns } from "@/services/workflow-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const log = createLogger("cron-hub");

const BUDGET_MS = 45_000;

/**
 * Notification hub tick (every 15 minutes):
 *  1. uptime checks that are due (they may produce events);
 *  2. digests, payment reminders and cross-post sources whose time has come;
 *  3. fan out events whose webhook-time fan-out never ran;
 *  4. deliver due retries and unstarted runs, round-robin across users.
 */
export async function POST(request: NextRequest) {
  if (!isCronAuthorised(request.headers)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid cron credentials." } }, { status: 401 });
  }

  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const run = await prisma.cronRun.create({ data: { job: "hub" }, select: { id: true } });
  try {
    // Each producer gets a slice of the budget, so deliveries always run.
    const uptime = await runDueChecks(started + BUDGET_MS / 5);
    const digests = await runDueDigests(started + (2 * BUDGET_MS) / 5);
    const reminders = await runDueReminders(started + (3 * BUDGET_MS) / 5);
    const crossposts = await pollDueCrossPosts(started + (4 * BUDGET_MS) / 5);
    const swept = await sweepUnfannedEvents();
    const runs = await drainDueRuns(deadline);

    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        processed: runs.SUCCESS + runs.FAILED + runs.SKIPPED + runs.RETRY,
        succeeded: runs.SUCCESS,
        failed: runs.FAILED,
        skipped: runs.SKIPPED,
      },
    });
    const continued = continueIfBacklogged("hub", runs.deferred + uptime.deferred + digests.deferred + reminders.deferred + crossposts.deferred, request.headers);
    const summary = { uptime, digests, reminders, crossposts, swept, runs, continued };
    log.info("hub tick complete", {
      ...runs,
      checked: uptime.checked,
      changes: uptime.changes,
      digests: digests.queued,
      reminders: reminders.queued,
      crossposts: crossposts.queued,
      swept,
      continued,
    });
    return NextResponse.json(summary);
  } catch (error) {
    log.error("hub tick failed", { error: error as Error });
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
