import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listAuditLogs } from "@/services/audit-service";
import { AuditAction } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Audit logs · Admin" };
export const dynamic = "force-dynamic";

const ACTIONS = Object.values(AuditAction);
const querySchema = z.object({
  action: z.enum(ACTIONS as [AuditAction, ...AuditAction[]]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});
const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminAuditLogsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("audit:read:all");
  const params = await searchParams;
  const parsed = querySchema.safeParse(params);
  const query = parsed.success ? parsed.data : querySchema.parse({});
  const { items, total } = await listAuditLogs({ action: query.action, page: query.page, pageSize: PAGE_SIZE });

  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
      <form className="flex gap-2">
        <select
          name="action"
          defaultValue={query.action ?? ""}
          aria-label="Filter by action"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All actions</option>
          {ACTIONS.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm hover:bg-secondary">
          Filter
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border scrollbar-subtle">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell className="max-w-48 truncate">
                    {entry.actor ? (
                      <Link href={`/admin/users/${entry.actor.id}`} className="hover:underline">
                        {entry.actor.email ?? entry.actor.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">System</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={entry.action.includes("FAILED") || entry.action.includes("DISABLED") ? "destructive" : "outline"}>
                      {entry.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {entry.targetType}
                    {entry.targetId ? <span className="block font-mono text-muted-foreground">{entry.targetId}</span> : null}
                  </TableCell>
                  <TableCell className="max-w-96">
                    {entry.metadata ? (
                      <code className="block truncate text-xs text-muted-foreground" title={JSON.stringify(entry.metadata)}>
                        {JSON.stringify(entry.metadata)}
                      </code>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination basePath="/admin/audit-logs" params={params} page={query.page} total={total} pageSize={PAGE_SIZE} noun="entries" />
    </div>
  );
}
