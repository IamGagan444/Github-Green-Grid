import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { authorize, enforceRateLimit, handleApiError } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { listRepositoryBranches } from "@/services/github-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
});

export async function GET(request: NextRequest) {
  try {
    const user = await authorize("automation:create:own");
    await enforceRateLimit(`github:branches:${user.userId}`, RATE_LIMITS.integrationRead);
    const { owner, name } = querySchema.parse({
      owner: request.nextUrl.searchParams.get("owner"),
      name: request.nextUrl.searchParams.get("name"),
    });
    const branches = await listRepositoryBranches(user.userId, owner, name, {
      refresh: request.nextUrl.searchParams.get("refresh") === "1",
    });
    return NextResponse.json({ branches });
  } catch (error) {
    return handleApiError(error, "integrations/github/branches");
  }
}
