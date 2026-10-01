import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExecutionDetail } from "@/components/executions/execution-detail";
import { requireAdmin } from "@/lib/auth";
import { AuthorizationError } from "@/lib/rbac";
import { idParamSchema } from "@/validators/automation";
import { getExecutionForActor } from "@/services/execution-service";

export const metadata: Metadata = { title: "Execution · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("execution:read:all");
  const parsed = idParamSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  let execution;
  try {
    execution = await getExecutionForActor(admin, parsed.data);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
      <div>
        <Link href="/admin/executions" className="text-xs text-muted-foreground hover:text-foreground">
          ← Executions
        </Link>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">
          {execution.automationName} · {execution.executionDate}
        </h2>
        <p className="text-sm text-muted-foreground">
          Owner:{" "}
          <Link href={`/admin/users/${execution.userId}`} className="hover:underline">
            {execution.user.email ?? execution.user.name ?? execution.userId}
          </Link>
        </p>
      </div>
      <ExecutionDetail
        execution={execution}
        automationHref={execution.automationId ? `/automations/${execution.automationId}` : null}
      />
    </div>
  );
}
