import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExecutionDetail } from "@/components/executions/execution-detail";
import { Header } from "@/components/layout/header";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/rbac";
import { idParamSchema } from "@/validators/automation";
import { getExecutionForActor } from "@/services/execution-service";

export const metadata: Metadata = { title: "Execution" };
export const dynamic = "force-dynamic";

export default async function ExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("execution:read:own");
  const parsed = idParamSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  let execution;
  try {
    execution = await getExecutionForActor(user, parsed.data);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  // The user-facing page only shows the caller's own runs; admins use /admin/executions.
  if (execution.userId !== user.userId) notFound();

  const preferences = await prisma.user.findUnique({ where: { id: user.userId }, select: { defaultTimezone: true } });

  return (
    <>
      <Header
        title={`${execution.automationName} · ${execution.executionDate}`}
        back={{ href: "/executions", label: "Executions" }}
      />
      <div className="px-4 py-6 sm:px-6">
        <ExecutionDetail
          execution={execution}
          timezone={preferences?.defaultTimezone}
          automationHref={execution.automationId ? `/automations/${execution.automationId}` : null}
        />
      </div>
    </>
  );
}
