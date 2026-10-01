import Link from "next/link";
import { ExternalLink, XCircle } from "lucide-react";

import { RunStatusBadge, StepStatusBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { aiSummarySchema } from "@/lib/ai/schema";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { getExecutionForActor } from "@/services/execution-service";

type Execution = Awaited<ReturnType<typeof getExecutionForActor>>;

interface RepositoryResult {
  fullName: string;
  branch: string | null;
  commitCount: number;
}

function parseRepositories(value: unknown): RepositoryResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is RepositoryResult =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as RepositoryResult).fullName === "string" &&
      typeof (entry as RepositoryResult).commitCount === "number",
  );
}

/** Slack message timestamps are "<epoch seconds>.<sequence>". */
function slackTsToDate(ts: string | null): Date | null {
  if (!ts) return null;
  const seconds = Number(ts.split(".")[0]);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

export function ExecutionDetail({
  execution,
  timezone,
  automationHref,
}: {
  execution: Execution;
  timezone?: string;
  automationHref: string | null;
}) {
  const repositories = parseRepositories(execution.repositories);
  const ai = execution.aiOutput ? aiSummarySchema.safeParse(execution.aiOutput) : null;
  const bullets = ai?.success ? ai.data.summary : [];

  const facts: Array<[string, React.ReactNode]> = [
    ["Status", <RunStatusBadge key="status" status={execution.status} />],
    [
      "Automation",
      automationHref ? (
        <Link key="automation" href={automationHref} className="hover:underline">
          {execution.automationName}
        </Link>
      ) : (
        `${execution.automationName} (deleted)`
      ),
    ],
    ["Date", execution.executionDate],
    ["Trigger", execution.trigger === "MANUAL" ? "Manual (Run now)" : "Scheduled"],
    ["Attempt", String(execution.attempt)],
    ["Scheduled for", execution.scheduledFor ? formatDateTime(execution.scheduledFor, timezone) : "—"],
    ["Started", formatDateTime(execution.startedAt, timezone)],
    ["Finished", execution.finishedAt ? formatDateTime(execution.finishedAt, timezone) : "—"],
    ["Duration", formatDuration(execution.durationMs)],
    ...(execution.nextRetryAt ? [["Next retry", formatDateTime(execution.nextRetryAt, timezone)] as [string, React.ReactNode]] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      {execution.status === "FAILED" || execution.status === "SKIPPED" ? (
        <div
          role="status"
          className={
            execution.status === "FAILED"
              ? "flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
              : "flex items-start gap-2 rounded-xl border border-border bg-secondary/40 p-4 text-sm"
          }
        >
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">{execution.status === "FAILED" ? "Failure reason" : "Skipped"}</p>
            <p className="text-muted-foreground">{execution.errorMessage ?? "No details recorded."}</p>
            {execution.errorCode ? <p className="mt-1 font-mono text-xs text-muted-foreground">{execution.errorCode}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Run</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <dl className="divide-y divide-border rounded-lg border border-border">
              {facts.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 px-3.5 py-2 text-sm">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <StepStatusBadge status={execution.githubStatus} label="GitHub" />
              <StepStatusBadge status={execution.aiStatus} label="AI" />
              <StepStatusBadge status={execution.slackStatus} label="Slack" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>GitHub</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0 text-sm">
            <p>
              <span className="text-2xl font-semibold tabular-nums">{execution.commitCount ?? "—"}</span>{" "}
              <span className="text-muted-foreground">commits found</span>
            </p>
            {repositories.length > 0 ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {repositories.map((repository) => (
                  <li key={`${repository.fullName}-${repository.branch}`} className="flex items-center justify-between gap-3 px-3.5 py-2">
                    <span className="min-w-0 truncate">
                      {repository.fullName} <Badge variant="outline">{repository.branch ?? "all branches"}</Badge>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{repository.commitCount}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Repositories were not reached in this run.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI output</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0 text-sm">
            {bullets.length > 0 ? (
              <>
                <ul className="flex flex-col gap-1">
                  {bullets.map((bullet) => (
                    <li key={bullet}>✅ {bullet}</li>
                  ))}
                </ul>
                {execution.aiModel ? <p className="mt-2 text-xs text-muted-foreground">Model: {execution.aiModel}</p> : null}
              </>
            ) : (
              <p className="text-muted-foreground">No validated AI output for this run.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Slack</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <dl className="divide-y divide-border rounded-lg border border-border text-sm">
              {[
                ["Channel", execution.slackChannelName ? `#${execution.slackChannelName}` : "—"],
                [
                  "Parent thread",
                  execution.slackParentTs
                    ? `${execution.slackParentTs} (${formatDateTime(slackTsToDate(execution.slackParentTs) ?? execution.startedAt, timezone)})`
                    : "—",
                ],
                [
                  "Reply",
                  execution.slackReplyTs
                    ? `${execution.slackReplyTs} (${formatDateTime(slackTsToDate(execution.slackReplyTs) ?? execution.startedAt, timezone)})`
                    : "—",
                ],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 px-3.5 py-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-all">{value}</dd>
                </div>
              ))}
            </dl>
            {execution.slackPermalink ? (
              <a
                href={execution.slackPermalink}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                Open in Slack
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
