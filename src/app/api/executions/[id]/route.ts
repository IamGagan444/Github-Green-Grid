import { NextResponse, type NextRequest } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { idParamSchema } from "@/validators/automation";
import { getExecutionForActor } from "@/services/execution-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize("execution:read:own");
    const id = idParamSchema.parse((await context.params).id);
    return NextResponse.json({ execution: await getExecutionForActor(user, id) });
  } catch (error) {
    return handleApiError(error, "execution:GET");
  }
}
