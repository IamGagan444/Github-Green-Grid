import { NextResponse, type NextRequest } from "next/server";

import { ApiError, handleApiError, readJson, requireApiUser } from "@/lib/api";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
import {
  listStoredRepositories,
  selectRepository,
  syncRepositories,
} from "@/lib/services/repositories";
import { selectRepositorySchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** `?refresh=1` re-reads the list from GitHub; otherwise the mirror is served. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";

    if (!refresh) {
      return NextResponse.json({ repositories: await listStoredRepositories(user.userId) });
    }

    const limit = await rateLimit(`repos:${user.userId}`, RATE_LIMITS.repositories);
    if (!limit.success) {
      throw new ApiError("RATE_LIMITED", "Too many refreshes. Try again shortly.");
    }

    const repositories = await syncRepositories(user.userId);
    return NextResponse.json({ repositories }, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    return handleApiError(error, "api/github/repositories:GET");
  }
}

/** Selects the repository GreenGrid is allowed to update. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();

    const limit = await rateLimit(`repos:select:${user.userId}`, RATE_LIMITS.scheduleWrite);
    if (!limit.success) {
      throw new ApiError("RATE_LIMITED", "Too many requests. Try again shortly.");
    }

    const body = await readJson(request, selectRepositorySchema);
    const repository = await selectRepository(user.userId, body.githubRepositoryId);

    return NextResponse.json({ repository }, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    return handleApiError(error, "api/github/repositories:POST");
  }
}
