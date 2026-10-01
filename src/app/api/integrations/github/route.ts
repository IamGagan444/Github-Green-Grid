import { NextResponse } from "next/server";

import { authorize, handleApiError } from "@/lib/api";
import { getGitHubIntegration } from "@/services/github-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await authorize("integration:github:manage:own");
    return NextResponse.json({ integration: await getGitHubIntegration(user.userId) });
  } catch (error) {
    return handleApiError(error, "integrations/github:GET");
  }
}
