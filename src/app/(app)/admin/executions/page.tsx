import type { Metadata } from "next";
import { History } from "lucide-react";

import { ExecutionFilters } from "@/components/executions/execution-filters";
import { ExecutionTable } from "@/components/executions/execution-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { requireAdmin } from "@/lib/auth";
import { executionQuerySchema } from "@/validators/automation";
import { listExecutions } from "@/services/execution-service";

export const metadata: Metadata = { title: "Executions · Admin" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminExecutionsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("execution:read:all");
  const params = await searchParams;
  const parsed = executionQuerySchema.safeParse(params);
  const query = parsed.success ? parsed.data : executionQuerySchema.parse({});

  const result = await listExecutions({
    automationId: query.automationId,
    status: query.status === "ALL" ? undefined : query.status,
    page: query.page,
    pageSize: query.pageSize,
  });

  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
      <ExecutionFilters basePath="/admin/executions" />
      {result.items.length === 0 ? (
        <EmptyState icon={History} title="No executions match" />
      ) : (
        <>
          <ExecutionTable rows={result.items} basePath="/admin/executions" showOwner />
          <Pagination
            basePath="/admin/executions"
            params={params}
            page={query.page}
            total={result.total}
            pageSize={query.pageSize}
            noun="executions"
          />
        </>
      )}
    </div>
  );
}
