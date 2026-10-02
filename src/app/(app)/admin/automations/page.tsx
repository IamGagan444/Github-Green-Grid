import type { Metadata } from "next";
import Link from "next/link";
import { Bot } from "lucide-react";
import { z } from "zod";

import { AutomationStatusControl } from "@/components/admin/automation-status-control";
import { AutomationStatusBadge, RunStatusBadge } from "@/components/status/status-badges";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { describeScheduleTimes } from "@/lib/automation/schedule";
import { formatDateTime } from "@/lib/format";
import { describeFrequency } from "@/lib/schedule/next-run";
import { timezoneLabel } from "@/lib/schedule/timezone";
import { listAllAutomations } from "@/services/automation-service";

export const metadata: Metadata = { title: "Automations · Admin" };
export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});
const PAGE_SIZE = 25;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminAutomationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("automation:read:all");
  const params = await searchParams;
  const parsed = querySchema.safeParse(params);
  const query = parsed.success ? parsed.data : querySchema.parse({});
  const { items, total } = await listAllAutomations({ status: query.status, page: query.page, pageSize: PAGE_SIZE });

  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap gap-2 text-sm">
        {[undefined, "ACTIVE", "PAUSED", "DISABLED"].map((status) => (
          <Link
            key={status ?? "all"}
            href={status ? `/admin/automations?status=${status}` : "/admin/automations"}
            className={
              query.status === status
                ? "rounded-md bg-secondary px-3 py-1.5 font-medium"
                : "rounded-md px-3 py-1.5 text-muted-foreground hover:bg-secondary/60"
            }
          >
            {status ? status.charAt(0) + status.slice(1).toLowerCase() : "All"}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Bot} title="No automations" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border scrollbar-subtle">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Slack</TableHead>
                <TableHead>Last execution</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((automation) => (
                <TableRow key={automation.id}>
                  <TableCell>
                    <Link href={`/automations/${automation.id}`} className="font-medium hover:underline">
                      {automation.name}
                    </Link>
                    {automation.blockers.length > 0 ? (
                      <p className="max-w-64 truncate text-xs text-warning" title={automation.blockers.join(" ")}>
                        {automation.blockers[0]}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">
                    <Link href={`/admin/users/${automation.userId}`} className="hover:underline">
                      {automation.owner.email ?? automation.owner.name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <AutomationStatusBadge status={automation.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {describeFrequency(automation.daysOfWeek)} · {describeScheduleTimes(automation.scheduleTimes)}
                    <br />
                    <span className="text-muted-foreground">{timezoneLabel(automation.timezone)}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    #{automation.slackChannelName}
                    {automation.slackTeamName ? <span className="text-muted-foreground"> · {automation.slackTeamName}</span> : null}
                  </TableCell>
                  <TableCell>
                    {automation.lastExecution ? (
                      <span className="flex flex-col gap-1">
                        <RunStatusBadge status={automation.lastExecution.status} />
                        <span className="text-xs text-muted-foreground">{formatDateTime(automation.lastExecution.startedAt)}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <AutomationStatusControl automationId={automation.id} name={automation.name} status={automation.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination basePath="/admin/automations" params={params} page={query.page} total={total} pageSize={PAGE_SIZE} noun="automations" />
    </div>
  );
}
