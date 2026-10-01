import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";

import { ExecutionFilters } from "@/components/executions/execution-filters";
import { ExecutionTable } from "@/components/executions/execution-table";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { executionQuerySchema } from "@/validators/automation";
import { listExecutions } from "@/services/execution-service";

export const metadata: Metadata = { title: "Executions" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ExecutionsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser("execution:read:own");
  const params = await searchParams;
  const parsed = executionQuerySchema.safeParse(params);
  const query = parsed.success ? parsed.data : executionQuerySchema.parse({});

  const [result, automations, preferences] = await Promise.all([
    listExecutions({
      userId: user.userId,
      automationId: query.automationId,
      status: query.status === "ALL" ? undefined : query.status,
      page: query.page,
      pageSize: query.pageSize,
    }),
    prisma.automation.findMany({
      where: { userId: user.userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findUnique({ where: { id: user.userId }, select: { defaultTimezone: true } }),
  ]);

  return (
    <>
      <Header title="Executions" description="Every standup run: what was found, generated and posted." />
      <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
        <ExecutionFilters automations={automations} basePath="/executions" />
        {result.items.length === 0 ? (
          <EmptyState
            icon={History}
            title="No executions match"
            description="Runs are recorded when an automation runs on schedule or with Run now."
            action={
              <Button asChild variant="outline">
                <Link href="/automations">View automations</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ExecutionTable rows={result.items} timezone={preferences?.defaultTimezone} />
            <Pagination
              basePath="/executions"
              params={params}
              page={query.page}
              total={result.total}
              pageSize={query.pageSize}
              noun="executions"
            />
          </>
        )}
      </div>
    </>
  );
}
