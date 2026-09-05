import { NextResponse, type NextRequest } from "next/server";

import { ApiError, handleApiError, readJson, requireApiUser } from "@/lib/api";
import { runScheduledActivity } from "@/lib/activity/run-activity";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
import { getOwnedSchedule } from "@/lib/services/schedules";
import { manualRunSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Run activity now". Verifies ownership and repository state, then performs
 * exactly one activity update and records the execution.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();

    const limit = await rateLimit(`manual-run:${user.userId}`, RATE_LIMITS.manualRun);
    if (!limit.success) {
      throw new ApiError(
        "RATE_LIMITED",
        "You've run activity a few times recently. Try again in a few minutes.",
      );
    }

    const { scheduleId } = await readJson(request, manualRunSchema);

    // Ownership check before any GitHub call.
    const schedule = await getOwnedSchedule(user.userId, scheduleId);
    if (schedule.repository.archived || !schedule.repository.canPush) {
      throw new ApiError(
        "FORBIDDEN",
        "GreenGrid can no longer write to this repository. Re-select it on the Repositories page.",
      );
    }

    const outcome = await runScheduledActivity({ scheduleId, trigger: "MANUAL" });

    if (outcome.status === "FAILED") {
      return NextResponse.json(
        { error: { code: "GITHUB_ERROR", message: outcome.reason } },
        { status: 502, headers: rateLimitHeaders(limit) },
      );
    }

    return NextResponse.json({ result: outcome }, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    return handleApiError(error, "api/activity/run");
  }
}
