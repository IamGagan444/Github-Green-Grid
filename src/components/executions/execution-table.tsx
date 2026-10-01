import Link from "next/link";

import { RunStatusBadge, StepStatusBadge } from "@/components/status/status-badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatDuration } from "@/lib/format";

type Step = "PENDING" | "SUCCESS" | "FAILED" | "SKIPPED";

export interface ExecutionRowView {
  id: string;
  automationName: string;
  executionDate: string;
  trigger: "SCHEDULED" | "MANUAL";
  status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  githubStatus: Step;
  aiStatus: Step;
  slackStatus: Step;
  commitCount: number | null;
  errorMessage: string | null;
  startedAt: Date;
  durationMs: number | null;
  user?: { name: string | null; email: string | null };
}

export function ExecutionTable({
  rows,
  basePath = "/executions",
  showOwner = false,
  timezone,
}: {
  rows: ExecutionRowView[];
  basePath?: string;
  showOwner?: boolean;
  timezone?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border scrollbar-subtle">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Automation</TableHead>
            {showOwner ? <TableHead>Owner</TableHead> : null}
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="text-right">Commits</TableHead>
            <TableHead>AI</TableHead>
            <TableHead>Slack</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap">
                <Link href={`${basePath}/${row.id}`} className="font-medium hover:underline">
                  {row.executionDate}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(row.startedAt, timezone)} · {row.trigger === "MANUAL" ? "Manual" : "Scheduled"}
                </p>
              </TableCell>
              <TableCell className="max-w-48 truncate">{row.automationName}</TableCell>
              {showOwner ? (
                <TableCell className="max-w-48 truncate text-muted-foreground">{row.user?.email ?? row.user?.name ?? "—"}</TableCell>
              ) : null}
              <TableCell>
                <RunStatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatDuration(row.durationMs)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.commitCount ?? "—"}</TableCell>
              <TableCell>
                <StepStatusBadge status={row.aiStatus} />
              </TableCell>
              <TableCell>
                <StepStatusBadge status={row.slackStatus} />
              </TableCell>
              <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={row.errorMessage ?? undefined}>
                {row.status === "FAILED" || row.status === "SKIPPED" ? row.errorMessage ?? "—" : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
