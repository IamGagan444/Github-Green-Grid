import { NextResponse, type NextRequest } from "next/server";

import { runScheduledActivity } from "@/lib/activity/run-activity";
import { prisma } from "@/lib/db";
import { getDueOccurrences } from "@/lib/schedule/next-run";
import { pruneExpiredSessions } from "@/lib/auth/maintenance";
import { isCronAuthorised } from "@/lib/scheduler/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel's Hobby plan caps function duration at 60s; higher values are only
// honoured on paid plans. The batch is bounded by the number of due slots.
export const maxDuration = 60;

interface CronSummary {
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
}

async function processDueSchedules(): Promise<CronSummary> {
  const now = new Date();

  const schedules = await prisma.schedule.findMany({
    where: {
      enabled: true,
      repository: { archived: false, canPush: true },
      // Disabled users and disconnected GitHub integrations never run.
      user: { status: "ACTIVE", githubIntegration: { status: "CONNECTED" } },
    },
    select: {
      id: true,
      timezone: true,
      commitsPerDay: true,
      daysOfWeek: true,
    },
  });

  const summary: CronSummary = { processed: 0, successful: 0, failed: 0, skipped: 0 };

  for (const schedule of schedules) {
    // A schedule can have several slots due at once if a poll was missed.
    // Already-executed slots are rejected by the idempotency key, not re-run.
    for (const due of getDueOccurrences(schedule, now)) {
      summary.processed += 1;

      // Each slot is isolated: one user's failure never aborts the batch.
      try {
        const outcome = await runScheduledActivity({
          scheduleId: schedule.id,
          trigger: "SCHEDULED",
          dayKey: due.dayKey,
          slotIndex: due.slotIndex,
          scheduledFor: due.runAt,
        });

        if (outcome.status === "COMPLETED") summary.successful += 1;
        else if (outcome.status === "SKIPPED") summary.skipped += 1;
        else summary.failed += 1;
      } catch (error) {
        summary.failed += 1;
        console.error("[cron] schedule execution threw", {
          scheduleId: schedule.id,
          slotIndex: due.slotIndex,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
  }

  return summary;
}

/** POST is the documented entry point for external schedulers. */
export async function POST(request: NextRequest) {
  if (!isCronAuthorised(request.headers)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid cron credentials." } },
      { status: 401 },
    );
  }

  try {
    const summary = await processDueSchedules();
    await pruneExpiredSessions();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[cron] batch failed", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Scheduled activity couldn't be completed." } },
      { status: 500 },
    );
  }
}

/** Vercel Cron issues GET requests; it shares the POST implementation. */
export async function GET(request: NextRequest) {
  return POST(request);
}
