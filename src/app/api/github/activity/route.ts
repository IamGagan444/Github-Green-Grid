import { NextResponse, type NextRequest } from "next/server";

import { ApiError, handleApiError, requireApiUser } from "@/lib/api";
import { getCalendarData } from "@/lib/activity/calendar";
import { getActivityHistory, getExecutionsForDay } from "@/lib/services/activity-history";
import { prisma } from "@/lib/db";
import { activityQuerySchema } from "@/lib/validation/schemas";
import { isValidTimezone } from "@/lib/schedule/timezone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `?view=calendar` returns 12 months of contribution data.
 * Otherwise a filtered, paginated execution history is returned.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const params = request.nextUrl.searchParams;

    if (params.get("view") === "calendar") {
      const requested = params.get("timezone");
      const timezone =
        requested && isValidTimezone(requested)
          ? requested
          : (
              await prisma.user.findUniqueOrThrow({
                where: { id: user.userId },
                select: { defaultTimezone: true },
              })
            ).defaultTimezone;

      return NextResponse.json(await getCalendarData(user.userId, timezone));
    }

    if (params.get("view") === "day") {
      const date = params.get("date") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new ApiError("VALIDATION_ERROR", "A date in YYYY-MM-DD form is required.");
      }
      return NextResponse.json({ rows: await getExecutionsForDay(user.userId, date) });
    }

    const query = activityQuerySchema.parse(Object.fromEntries(params.entries()));
    return NextResponse.json(await getActivityHistory(user.userId, query));
  } catch (error) {
    return handleApiError(error, "api/github/activity");
  }
}
