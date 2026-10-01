import { NextResponse, type NextRequest } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { executionQuerySchema } from "@/validators/automation";
import { listExecutions } from "@/services/execution-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The caller's own execution history. Admin-wide history lives under /admin. */
export async function GET(request: NextRequest) {
  try {
    const user = await authorize("execution:read:own");
    const query = executionQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const result = await listExecutions({
      userId: user.userId,
      automationId: query.automationId,
      status: query.status === "ALL" ? undefined : query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, "executions:GET");
  }
}
