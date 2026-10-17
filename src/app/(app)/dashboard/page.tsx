import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Bot, CalendarClock, CirclePlay, MessageCircle, Send, Settings } from "lucide-react";

import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { AutomationGallery } from "@/components/dashboard/automation-gallery";
import { NewAutomationMenu } from "@/components/dashboard/new-automation-menu";
import { ProductCard } from "@/components/dashboard/product-card";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { StatsCard } from "@/components/dashboard/stats-card";
import { GithubIcon } from "@/components/icons/github-icon";
import { GoogleIcon } from "@/components/icons/google-icon";
import { InstagramIcon } from "@/components/icons/instagram-icon";
import { SlackIcon } from "@/components/icons/slack-icon";
import { Header } from "@/components/layout/header";
import { IntegrationBadge } from "@/components/status/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsSkeleton } from "@/components/ui/skeletons";
import { displayNameFor, requireUser } from "@/lib/auth";
import { localDayKey } from "@/lib/automation/schedule";
import { prisma } from "@/lib/db";
import { greetingFor } from "@/lib/format";
import { timezoneLabel } from "@/lib/schedule/timezone";
import { formatLongDate } from "@/lib/slack/message";
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
        actions={<NewAutomationMenu />}
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
  const { standups, instagram, commits } = data;

  return (
    <>
      <SetupChecklist steps={data.setup} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          label="Active automations"
          value={data.activeTotal}
          hint="standups, Instagram, commits and hub rules"
          icon={CirclePlay}
          tone="success"
        />
        <StatsCard
          label="Standups posted today"
          value={standups.successToday}
          hint={`${standups.runsToday} run${standups.runsToday === 1 ? "" : "s"} today`}
          icon={Bot}
        />
        <StatsCard
          label="Instagram DMs sent"
          value={instagram.sentWeek}
          hint={`last 7 days · ${instagram.triggeredWeek} triggered`}
          icon={Send}
        />
        <StatsCard
          label="Needs attention"
          value={data.needsAttention}
          hint={data.needsAttention > 0 ? "failed runs or disconnected accounts" : "all good"}
          icon={AlertTriangle}
          tone={data.needsAttention > 0 ? "destructive" : "default"}
        />
      </div>

      <section aria-labelledby="automations-heading" className="flex flex-col gap-3">
        <h2 id="automations-heading" className="text-sm font-medium text-muted-foreground">
          Your automations
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <ProductCard
            icon={<Bot className="size-4" aria-hidden="true" />}
            title="Standup updates"
            description="Your commits, summarised by AI and posted to Slack on schedule."
            status={productStatus(standups.ready, standups.active, standups.total)}
            blocker={
              standups.ready
                ? undefined
                : `Connect ${[!data.github.connected && "GitHub", !data.slackConnected && "Slack"].filter(Boolean).join(" and ")} to start.`
            }
            metrics={[
              { label: "Active", value: standups.active },
              { label: "Posted today", value: standups.successToday, tone: "success" },
              { label: "Failed today", value: standups.failedToday, tone: "destructive" },
            ]}
            primary={
              !data.github.connected
                ? { label: "Connect GitHub", href: "/api/integrations/github/connect?returnTo=/dashboard", external: true }
                : !data.slackConnected
                  ? { label: "Connect Slack", href: "/api/integrations/slack/connect?returnTo=/dashboard", external: true }
                  : standups.total === 0
                    ? { label: "Create standup", href: "/automations/new" }
                    : { label: "Manage", href: "/automations" }
            }
            secondary={standups.total > 0 ? { label: "Run history", href: "/executions" } : undefined}
          />

          <ProductCard
            icon={<MessageCircle className="size-4" aria-hidden="true" />}
            title="Instagram auto-DM"
            description="DM a link when someone comments or messages a keyword."
            status={productStatus(instagram.ready, instagram.active, instagram.total)}
            blocker={instagram.ready ? undefined : "Connect an Instagram Business or Creator account to start."}
            metrics={[
              { label: "Active", value: instagram.active },
              { label: "DMs (7 days)", value: instagram.sentWeek, tone: "success" },
              { label: "Failed (7 days)", value: instagram.failedWeek, tone: "destructive" },
            ]}
            primary={
              !instagram.ready
                ? { label: "Connect Instagram", href: "/api/integrations/instagram/connect?returnTo=/dashboard", external: true }
                : instagram.total === 0
                  ? { label: "Create auto-DM", href: "/instagram/new" }
                  : { label: "Manage", href: "/instagram" }
            }
          />

          <ProductCard
            icon={<CalendarClock className="size-4" aria-hidden="true" />}
            title="Commit activity"
            description="Small, real commits to a repo you choose, on the days you pick."
            status={productStatus(commits.ready, commits.enabled, commits.total)}
            blocker={commits.ready ? undefined : "Connect GitHub to choose repositories."}
            metrics={[
              { label: "Schedules on", value: commits.enabled },
              { label: "Done (7 days)", value: commits.completedWeek, tone: "success" },
              { label: "Total schedules", value: commits.total },
            ]}
            primary={
              !commits.ready
                ? { label: "Connect GitHub", href: "/api/integrations/github/connect?returnTo=/dashboard", external: true }
                : commits.total === 0
                  ? { label: "Set up schedule", href: "/dashboard/schedule" }
                  : { label: "Manage", href: "/dashboard/schedule" }
            }
            secondary={commits.ready ? { label: "Activity", href: "/dashboard/activity" } : undefined}
          />
        </div>
      </section>

      <AutomationGallery
        hubReady={data.hub.ready}
        connections={{
          ...data.connections,
          github: data.github.connected,
          slack: data.slackConnected,
        }}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ActivityFeed items={data.feed} timezone={timezone} />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Connected accounts</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings#integrations">
                <Settings aria-hidden="true" />
                Manage
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <IntegrationRow
              icon={<GoogleIcon className="size-4" />}
              name="Google"
              detail={email ? `${email} · sign-in` : "Sign-in"}
              status="CONNECTED"
            />
            <IntegrationRow
              icon={<GithubIcon className="size-4" />}
              name="GitHub"
              detail={data.github.username ? `@${data.github.username}` : "Standups and commit activity"}
              status={data.github.status}
            />
            <IntegrationRow
              icon={<SlackIcon className="size-4" />}
              name="Slack"
              detail={
                data.slackWorkspaces
                  .filter((workspace) => workspace.status === "CONNECTED")
                  .map((workspace) => workspace.teamName)
                  .join(", ") || "Where standups are posted"
              }
              status={
                data.slackConnected
                  ? "CONNECTED"
                  : data.slackWorkspaces.some((workspace) => workspace.status === "REVOKED")
                    ? "REVOKED"
                    : "NOT_CONNECTED"
              }
            />
            <IntegrationRow
              icon={<InstagramIcon className="size-4" />}
              name="Instagram"
              detail={
                instagram.accounts
                  .filter((account) => account.status === "CONNECTED")
                  .map((account) => `@${account.username}`)
                  .join(", ") || "Comment and DM automations"
              }
              status={
                data.instagramConnected
                  ? "CONNECTED"
                  : instagram.accounts.some((account) => account.status === "REVOKED")
                    ? "REVOKED"
                    : "NOT_CONNECTED"
              }
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function productStatus(ready: boolean, active: number, total: number) {
  if (!ready) return { label: "Needs setup", tone: "setup" as const };
  if (active > 0) return { label: `${active} active`, tone: "active" as const };
  if (total > 0) return { label: "Paused", tone: "idle" as const };
  return { label: "Not started", tone: "idle" as const };
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
