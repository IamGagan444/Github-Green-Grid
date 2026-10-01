import { NextResponse, type NextRequest } from "next/server";

import { authorize, enforceRateLimit, handleApiError } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { listAccessibleRepositories } from "@/services/github-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Repositories the connected GitHub identity can read, for the automation form. */
export async function GET(request: NextRequest) {
  try {
    const user = await authorize("automation:create:own");
    await enforceRateLimit(`github:repos:${user.userId}`, RATE_LIMITS.integrationRead);
    const repositories = await listAccessibleRepositories(user.userId, {
      refresh: request.nextUrl.searchParams.get("refresh") === "1",
    });
    return NextResponse.json({
      repositories: repositories
        .filter((repository) => !repository.archived)
        .map((repository) => ({
          id: repository.githubRepositoryId,
          owner: repository.owner,
          name: repository.name,
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          private: repository.private,
          pushedAt: repository.pushedAt,
        })),
    });
  } catch (error) {
    return handleApiError(error, "integrations/github/repositories");
  }
}
