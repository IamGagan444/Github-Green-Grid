import { ExternalLink } from "lucide-react";

import { ActivityStatus, type ExecutionStatusValue } from "@/components/activity/activity-status";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDuration, shortSha } from "@/lib/format";
import type { ActivityHistoryRow } from "@/lib/services/activity-history";

/**
 * Execution history. Renders as a table on wide screens and as stacked cards on
 * mobile so no horizontal scrolling is needed for the primary data.
 */
export function ActivityTable({ rows }: { rows: ActivityHistoryRow[] }) {
  return (
    <>
      <Card className="hidden overflow-hidden p-0 md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Commit</TableHead>
              <TableHead className="text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(row.scheduledFor)}
                </TableCell>
                <TableCell className="font-medium">{row.repository.fullName}</TableCell>
                <TableCell>
                  <ActivityStatus status={row.status as ExecutionStatusValue} />
                </TableCell>
                <TableCell className="max-w-xs">
                  <CommitCell row={row} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatDuration(row.durationMs)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.repository.fullName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(row.scheduledFor)} · {formatDuration(row.durationMs)}
                  </p>
                </div>
                <ActivityStatus status={row.status as ExecutionStatusValue} />
              </div>
              <div className="mt-3 text-sm">
                <CommitCell row={row} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

function CommitCell({ row }: { row: ActivityHistoryRow }) {
  if (row.status === "FAILED") {
    return (
      <span className="text-sm text-muted-foreground">
        {row.errorMessage ?? "Scheduled activity couldn't be completed."}
      </span>
    );
  }

  if (!row.commitUrl) {
    return <span className="text-sm text-muted-foreground">No commit created</span>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-sm">{row.commitMessage}</span>
      <a
        href={row.commitUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex w-fit items-center gap-1 rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        View commit
        <span className="font-mono text-muted-foreground">{shortSha(row.commitSha)}</span>
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    </div>
  );
}
