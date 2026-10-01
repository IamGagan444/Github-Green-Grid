import type { Metadata } from "next";
import { CheckCircle2, CircleDashed, Database, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatDuration } from "@/lib/format";
import { getSystemHealth } from "@/services/admin-service";

export const metadata: Metadata = { title: "System · Admin" };
export const dynamic = "force-dynamic";

const CONFIG_LABELS: Record<string, string> = {
  database: "Database URL",
  authSecret: "AUTH_SECRET",
  googleOAuth: "Google OAuth",
  githubApp: "GitHub App",
  slackOAuth: "Slack OAuth",
  slackSigningSecret: "Slack signing secret (events)",
  slackUserPosting: "Slack user scopes (Post as me)",
  nvidiaApi: "NVIDIA API",
  cronSecret: "CRON_SECRET",
  encryptionKey: "ENCRYPTION_KEY",
  distributedRateLimit: "Distributed rate limiting (Upstash)",
};

export default async function AdminSystemPage() {
  const admin = await requireAdmin("system:read");
  const health = await getSystemHealth(admin);
  const lastStandupRun = health.lastCronRuns.find((run) => run.job === "standups");

  return (
    <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Database</p>
          <p className="mt-1.5 flex items-center gap-2 text-lg font-semibold">
            <Database className="size-4" aria-hidden="true" />
            {health.databaseOk ? "Healthy" : "Unreachable"}
          </p>
          <p className="text-xs text-muted-foreground">{health.databaseLatencyMs} ms round trip</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Last scheduler tick</p>
          <p className="mt-1.5 text-lg font-semibold">
            {lastStandupRun ? formatDateTime(lastStandupRun.startedAt) : "Never"}
          </p>
          <p className="text-xs text-muted-foreground">
            {lastStandupRun?.error ? "Failed" : lastStandupRun ? `${lastStandupRun.processed} processed` : "Configure the cron trigger"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Running / stuck executions</p>
          <p className="mt-1.5 text-lg font-semibold tabular-nums">
            {health.runningExecutions} / {health.stuckExecutions}
          </p>
          <p className="text-xs text-muted-foreground">Stuck runs are resumed automatically on the next tick.</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Pending retries</p>
          <p className="mt-1.5 text-lg font-semibold tabular-nums">{health.pendingRetries}</p>
          <p className="text-xs text-muted-foreground">
            {health.runtime.environment} · Node {health.runtime.node}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 pt-0 sm:grid-cols-2">
          {Object.entries(health.configuration).map(([key, configured]) => (
            <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
              <span>{CONFIG_LABELS[key] ?? key}</span>
              {configured ? (
                <Badge variant="success">
                  <CheckCircle2 aria-hidden="true" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="outline">
                  <CircleDashed aria-hidden="true" />
                  Not set
                </Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent scheduler runs</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Processed</TableHead>
                  <TableHead className="text-right">OK</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.lastCronRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{run.job}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(run.startedAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.finishedAt ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime()) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{run.processed}</TableCell>
                    <TableCell className="text-right tabular-nums">{run.succeeded}</TableCell>
                    <TableCell className="text-right tabular-nums">{run.failed}</TableCell>
                    <TableCell className="text-right tabular-nums">{run.skipped}</TableCell>
                    <TableCell>
                      {run.error ? (
                        <Badge variant="destructive">
                          <XCircle aria-hidden="true" />
                          {run.error}
                        </Badge>
                      ) : run.finishedAt ? (
                        <Badge variant="success">OK</Badge>
                      ) : (
                        <Badge variant="warning">Running</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
