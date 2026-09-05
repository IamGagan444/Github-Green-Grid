import { NextResponse, type NextRequest } from "next/server";

import { ApiError, handleApiError, readJson, requireApiUser } from "@/lib/api";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
import { createSchedule, listSchedules } from "@/lib/services/schedules";
import { createScheduleSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ schedules: await listSchedules(user.userId) });
  } catch (error) {
    return handleApiError(error, "api/schedules:GET");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();

    const limit = await rateLimit(`schedules:create:${user.userId}`, RATE_LIMITS.scheduleWrite);
    if (!limit.success) {
      throw new ApiError("RATE_LIMITED", "Too many schedule changes. Try again shortly.");
    }

    const input = await readJson(request, createScheduleSchema);
    const schedule = await createSchedule(user.userId, input);

    return NextResponse.json({ schedule }, { status: 201, headers: rateLimitHeaders(limit) });
  } catch (error) {
    return handleApiError(error, "api/schedules:POST");
  }
}
