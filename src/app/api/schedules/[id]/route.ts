import { NextResponse, type NextRequest } from "next/server";

import { ApiError, handleApiError, readJson, requireApiUser } from "@/lib/api";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
import { deleteSchedule, getOwnedSchedule, updateSchedule } from "@/lib/services/schedules";
import { updateScheduleSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    return NextResponse.json({ schedule: await getOwnedSchedule(user.userId, id) });
  } catch (error) {
    return handleApiError(error, "api/schedules/[id]:GET");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;

    const limit = await rateLimit(`schedules:update:${user.userId}`, RATE_LIMITS.scheduleWrite);
    if (!limit.success) {
      throw new ApiError("RATE_LIMITED", "Too many schedule changes. Try again shortly.");
    }

    const input = await readJson(request, updateScheduleSchema);
    const schedule = await updateSchedule(user.userId, id, input);

    return NextResponse.json({ schedule }, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    return handleApiError(error, "api/schedules/[id]:PATCH");
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;

    const limit = await rateLimit(`schedules:delete:${user.userId}`, RATE_LIMITS.scheduleWrite);
    if (!limit.success) {
      throw new ApiError("RATE_LIMITED", "Too many schedule changes. Try again shortly.");
    }

    await deleteSchedule(user.userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, "api/schedules/[id]:DELETE");
  }
}
