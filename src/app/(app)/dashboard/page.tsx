import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  Bot,
  CheckCircle2,
  CirclePlay,
  History,
  ListChecks,
  Plus,
  XCircle,
} from "lucide-react";

import { StatsCard } from "@/components/dashboard/stats-card";
import { GithubIcon } from "@/components/icons/github-icon";
import { GoogleIcon } from "@/components/icons/google-icon";
import { SlackIcon } from "@/components/icons/slack-icon";
import { Header } from "@/components/layout/header";
import { IntegrationBadge, RunStatusBadge } from "@/components/status/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatsSkeleton } from "@/components/ui/skeletons";
import { displayNameFor, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, greetingFor } from "@/lib/format";
import { formatLongDate } from "@/lib/slack/message";
import { localDayKey } from "@/lib/automation/schedule";
import { timezoneLabel } from "@/lib/schedule/timezone";
import { getUserDashboard } from "@/services/dashboard-service";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser("dashboard:view:own");
  const preferences = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { defaultTimezone: true },
  });
  const timezone = preferences?.defaultTimezone ?? "UTC";
  const now = new Date();

  return (
    <>
      <Header
        title={`${greetingFor(now, timezone)}, ${displayNameFor(user)}`}
        description={`${formatLongDate(localDayKey(now, timezone))} · ${timezoneLabel(timezone)}`}
        actions={
          <Button asChild>
            <Link href="/automations/new">
              <Plus aria-hidden="true" />
              Create automation
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        <Suspense fallback={<StatsSkeleton />}>
          <DashboardBody userId={user.userId} email={user.email} timezone={timezone} />
        </Suspense>
      </div>
    </>
  );
}

async function DashboardBody({
  userId,
  email,
  timezone,
}: {
  userId: string;
  email: string | null;
  timezone: string;
}) {
  const data = await getUserDashboard(userId, timezone);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatsCard label="Automations" value={data.automationCount} hint="total" icon={Bot} />
        <StatsCard label="Active" value={data.activeCount} hint="running on schedule" icon={CirclePlay} tone="success" />
        <StatsCard label="Today's executions" value={data.executionsToday} hint={data.today} icon={ListChecks} />
        <StatsCard label="Successful" value={data.successfulToday} hint="today" icon={CheckCircle2} tone="success" />
        <StatsCard
          label="Failed"
          value={data.failedToday}
          hint="today"
          icon={XCircle}
          tone={data.failedToday > 0 ? "destructive" : "default"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Recent automation activity</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/executions">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {data.recent.length === 0 ? (
              <EmptyState
                icon={History}
                title="No runs yet"
                description="When an automation runs — on schedule or with Run now — it appears here."
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-border">
                {data.recent.map((execution) => (
                  <li key={execution.id}>
                    <Link
                      href={`/executions/${execution.id}`}
                      className="flex items-center justify-between gap-3 rounded-md py-3 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{execution.automationName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {execution.executionDate}
                          {execution.commitCount !== null ? ` · ${execution.commitCount} commits` : ""}
                          {execution.slackChannelName ? ` · #${execution.slackChannelName}` : ""}
                          {execution.status === "FAILED" && execution.errorMessage ? ` · ${execution.errorMessage}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <RunStatusBadge status={execution.status} />
                        <span className="text-[11px] text-muted-foreground">
                          {formatDateTime(execution.startedAt, timezone)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              <IntegrationRow icon={<GoogleIcon className="size-4" />} name="Google" detail={email ?? "Signed in"} status="CONNECTED" />
              <IntegrationRow
                icon={<GithubIcon className="size-4" />}
                name="GitHub"
                detail={data.github.username ? `@${data.github.username}` : "Not connected"}
                status={data.github.status}
              />
              <IntegrationRow
                icon={<SlackIcon className="size-4" />}
                name="Slack"
                detail={
                  data.slackWorkspaces.filter((workspace) => workspace.status === "CONNECTED").map((workspace) => workspace.teamName).join(", ") ||
                  "Not connected"
                }
                status={
                  data.slackConnected
                    ? "CONNECTED"
                    : data.slackWorkspaces.some((workspace) => workspace.status === "REVOKED")
                      ? "REVOKED"
                      : "NOT_CONNECTED"
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 pt-0">
              <Button asChild className="justify-start">
                <Link href="/automations/new">
                  <Plus aria-hidden="true" />
                  Create automation
                </Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <a href="/api/integrations/github/connect?returnTo=/dashboard">
                  <GithubIcon className="size-4" />
                  {data.github.connected ? "Reconnect GitHub" : "Connect GitHub"}
                </a>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <a href="/api/integrations/slack/connect?returnTo=/dashboard">
                  <SlackIcon className="size-4" />
                  {data.slackConnected ? "Add Slack workspace" : "Connect Slack"}
                </a>
              </Button>
              <Button asChild variant="ghost" className="justify-start">
                <Link href="/automations">
                  <Bot aria-hidden="true" />
                  View automations
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function IntegrationRow({
  icon,
  name,
  detail,
  status,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  status: "CONNECTED" | "DISCONNECTED" | "REVOKED" | "NOT_CONNECTED";
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/40">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <IntegrationBadge status={status} />
    </div>
  );
}
