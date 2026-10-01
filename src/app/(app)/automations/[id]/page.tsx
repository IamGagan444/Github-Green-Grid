import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, History } from "lucide-react";

import { AutomationActions } from "@/components/automations/automation-actions";
import {
  COMMIT_WINDOW_OPTIONS,
  labelFor,
  MESSAGE_STYLE_OPTIONS,
  POSTING_MODE_OPTIONS,
  THREAD_MODE_OPTIONS,
} from "@/components/automations/options";
import { ExecutionTable } from "@/components/executions/execution-table";
import { Header } from "@/components/layout/header";
import { AutomationStatusBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { formatScheduleTime } from "@/lib/automation/schedule";
import { formatDateTime } from "@/lib/format";
import { AuthorizationError } from "@/lib/rbac";
import { describeFrequency } from "@/lib/schedule/next-run";
import { timezoneLabel } from "@/lib/schedule/timezone";
import { idParamSchema } from "@/validators/automation";
import { getAutomationForActor } from "@/services/automation-service";
import { listExecutions } from "@/services/execution-service";

export const metadata: Metadata = { title: "Automation" };
export const dynamic = "force-dynamic";

export default async function AutomationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("automation:read:own");
  const parsed = idParamSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  let automation;
  try {
    automation = await getAutomationForActor(user, parsed.data);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  const isOwner = automation.userId === user.userId;
  const executions = await listExecutions({ automationId: automation.id, userId: automation.userId, page: 1, pageSize: 10 });

  const rows: Array<[string, React.ReactNode]> = [
    [
      "Repositories",
      <ul key="repos" className="flex flex-col gap-0.5">
        {automation.githubSources.map((source) => (
          <li key={source.repositoryId}>
            {source.fullName} <Badge variant="outline">{source.branch ?? "all branches"}</Badge>
          </li>
        ))}
      </ul>,
    ],
    ["Commit date", labelFor(COMMIT_WINDOW_OPTIONS, automation.commitWindow)],
    ["Message style", labelFor(MESSAGE_STYLE_OPTIONS, automation.messageStyle)],
    ["Quick note", automation.quickNote ?? "—"],
    ["Slack", `#${automation.slackChannelName}${automation.slackTeamName ? ` · ${automation.slackTeamName}` : ""}`],
    ["Post as", labelFor(POSTING_MODE_OPTIONS, automation.postingMode)],
    ["Thread", labelFor(THREAD_MODE_OPTIONS, automation.threadMode)],
    [
      "Schedule",
      `${describeFrequency(automation.daysOfWeek)} at ${formatScheduleTime(automation.scheduleTime)} (${timezoneLabel(automation.timezone)})`,
    ],
    ["Next run", automation.nextRunAt ? formatDateTime(automation.nextRunAt, automation.timezone) : "—"],
    ["Created", formatDateTime(automation.createdAt, automation.timezone)],
  ];

  return (
    <>
      <Header
        title={automation.name}
        back={{ href: isOwner ? "/automations" : "/admin/automations", label: isOwner ? "Automations" : "All automations" }}
        description={<AutomationStatusBadge status={automation.status} />}
        actions={
          isOwner ? (
            <AutomationActions
              id={automation.id}
              name={automation.name}
              status={automation.status}
              canRun={automation.blockers.length === 0}
              layout="inline"
            />
          ) : null
        }
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        {automation.blockers.length > 0 ? (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="font-medium">This automation cannot run right now.</p>
              <p className="text-muted-foreground">{automation.blockers.join(" ")}</p>
              {isOwner ? (
                <Button asChild variant="link" className="h-auto px-0">
                  <Link href="/settings#integrations">Open integrations</Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <dl className="divide-y divide-border rounded-lg border border-border">
              {rows.map(([label, value]) => (
                <div key={label} className="grid gap-1 px-3.5 py-2.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <section aria-labelledby="history-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="history-heading" className="text-sm font-medium">
              Recent executions
            </h2>
            {isOwner ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/executions?automationId=${automation.id}`}>View all</Link>
              </Button>
            ) : null}
          </div>
          {executions.items.length === 0 ? (
            <EmptyState icon={History} title="No executions yet" description="Runs appear here after the first scheduled time or a Run now." />
          ) : (
            <ExecutionTable rows={executions.items} timezone={automation.timezone} basePath={isOwner ? "/executions" : "/admin/executions"} />
          )}
        </section>
      </div>
    </>
  );
}
