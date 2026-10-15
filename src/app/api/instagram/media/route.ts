import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { authorize, enforceRateLimit, handleApiError } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { idParamSchema } from "@/validators/automation";
import { listAccountMedia } from "@/services/instagram-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({ integrationId: idParamSchema, refresh: z.enum(["1"]).optional() });

/** Recent posts and reels of a connected account, for the automation post picker. */
export async function GET(request: NextRequest) {
  try {
    const user = await authorize("automation:create:own");
    await enforceRateLimit(`instagram:media:${user.userId}`, RATE_LIMITS.integrationRead);
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const media = await listAccountMedia(user.userId, query.integrationId, { refresh: query.refresh === "1" });
    return NextResponse.json({ media });
  } catch (error) {
    return handleApiError(error, "instagram/media");
  }
}
