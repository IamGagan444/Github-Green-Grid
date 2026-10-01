import Link from "next/link";
import { AlertTriangle, CalendarClock, GitBranch, Hash } from "lucide-react";

import { AutomationActions } from "@/components/automations/automation-actions";
import { AutomationStatusBadge, RunStatusBadge } from "@/components/status/status-badges";
import { Card } from "@/components/ui/card";
import { describeScheduleTimes } from "@/lib/automation/schedule";
import { formatDateTime } from "@/lib/format";
import { describeFrequency } from "@/lib/schedule/next-run";
import { timezoneLabel } from "@/lib/schedule/timezone";
import type { AutomationSummary } from "@/services/automation-service";

export function AutomationCard({ automation }: { automation: AutomationSummary }) {
  const repositories = automation.githubSources.map(
    (source) => `${source.fullName}${source.branch ? `@${source.branch}` : " (all branches)"}`,
  );

  return (
    <Card className="flex flex-col gap-4 p-5 transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/automations/${automation.id}`}
            className="block truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {automation.name}
          </Link>
          <div className="mt-1.5">
            <AutomationStatusBadge status={automation.status} />
          </div>
        </div>
        <AutomationActions
          id={automation.id}
          name={automation.name}
          status={automation.status}
          canRun={automation.blockers.length === 0}
        />
      </div>

      <dl className="grid gap-2 text-sm">
        <div className="flex items-start gap-2">
          <dt className="sr-only">Schedule</dt>
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd>
            {describeFrequency(automation.daysOfWeek)} · {describeScheduleTimes(automation.scheduleTimes)}{" "}
            <span className="text-muted-foreground">· {timezoneLabel(automation.timezone)}</span>
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">GitHub repositories</dt>
          <GitBranch className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd className="min-w-0 truncate" title={repositories.join(", ")}>
            {repositories.join(", ")}
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">Slack channel</dt>
          <Hash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd className="min-w-0 truncate">
            {automation.slackChannelName}
            {automation.slackTeamName ? <span className="text-muted-foreground"> · {automation.slackTeamName}</span> : null}
          </dd>
        </div>
      </dl>

      {automation.blockers.length > 0 ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
          {automation.blockers.join(" ")}
        </p>
      ) : null}

      <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
        <div>
          <p className="text-muted-foreground">Last execution</p>
          {automation.lastExecution ? (
            <Link href={`/executions/${automation.lastExecution.id}`} className="mt-1 inline-flex items-center gap-1.5 hover:underline">
              <RunStatusBadge status={automation.lastExecution.status} />
              <span className="text-muted-foreground">{automation.lastExecution.executionDate}</span>
            </Link>
          ) : (
            <p className="mt-1">Never</p>
          )}
        </div>
        <div>
          <p className="text-muted-foreground">Next execution</p>
          <p className="mt-1">
            {automation.nextRunAt ? formatDateTime(automation.nextRunAt, automation.timezone) : automation.status === "ACTIVE" ? "Blocked" : "Paused"}
          </p>
        </div>
      </div>
    </Card>
  );
}
