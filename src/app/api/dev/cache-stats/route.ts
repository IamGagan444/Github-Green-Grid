import { NextResponse } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { getCacheMetrics } from "@/lib/cache/cache";
import { getRedisCommandCount } from "@/lib/cache/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Development only: cache hits, misses, shared loads and Redis commands sent
 * by this server process. Returns 404 in production.
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development") return new NextResponse(null, { status: 404 });
  try {
    await authorize("dashboard:view:own");
    return NextResponse.json({ cache: getCacheMetrics(), redisCommandsTotal: getRedisCommandCount() });
  } catch (error) {
    return handleApiError(error, "dev/cache-stats");
  }
}
