import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { authorize, enforceRateLimit, handleApiError } from "@/lib/api";
import { MEDIA_CURSOR_PATTERN } from "@/lib/instagram/client";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema } from "@/validators/automation";
import { listAccountMedia } from "@/services/instagram-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z
  .object({
    integrationId: idParamSchema,
    cursor: z.string().regex(MEDIA_CURSOR_PATTERN, "Invalid cursor.").optional(),
    refresh: z.enum(["1"]).optional(),
  })
  .strict();

/** Posts and reels of a connected account, 10 per page, for the automation post picker. */
export async function GET(request: NextRequest) {
  try {
    const user = await authorize("automation:create:own");
    await enforceRateLimit(`instagram:media:${user.userId}`, RATE_LIMITS.integrationRead);
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const page = await listAccountMedia(user.userId, query.integrationId, {
      cursor: query.cursor ?? null,
      refresh: query.refresh === "1",
    });
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error, "instagram/media");
  }
}
