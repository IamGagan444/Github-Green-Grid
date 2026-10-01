import type { Metadata } from "next";
import {
  Bot,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  ListChecks,
  UserCheck,
  UserX,
  Users,
  XCircle,
} from "lucide-react";

import { StatsCard } from "@/components/dashboard/stats-card";
import { GithubIcon } from "@/components/icons/github-icon";
import { SlackIcon } from "@/components/icons/slack-icon";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { getAdminOverview } from "@/services/admin-service";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const admin = await requireAdmin();
  const stats = await getAdminOverview(admin);

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
      <section aria-labelledby="users-heading">
        <h2 id="users-heading" className="mb-3 text-sm font-medium">Users</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatsCard label="Total users" value={stats.totalUsers} icon={Users} />
          <StatsCard label="Active users" value={stats.activeUsers} icon={UserCheck} tone="success" />
          <StatsCard label="Disabled users" value={stats.disabledUsers} icon={UserX} tone={stats.disabledUsers > 0 ? "destructive" : "default"} />
        </div>
      </section>

      <section aria-labelledby="automations-heading">
        <h2 id="automations-heading" className="mb-3 text-sm font-medium">Automations</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatsCard label="Total automations" value={stats.totalAutomations} icon={Bot} />
          <StatsCard label="Active" value={stats.activeAutomations} icon={CirclePlay} tone="success" />
          <StatsCard label="Paused" value={stats.pausedAutomations} icon={CirclePause} />
        </div>
      </section>

      <section aria-labelledby="executions-heading">
        <h2 id="executions-heading" className="mb-3 text-sm font-medium">Executions today (UTC)</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatsCard label="Executions today" value={stats.executionsToday} icon={ListChecks} />
          <StatsCard label="Successful" value={stats.successfulToday} icon={CheckCircle2} tone="success" />
          <StatsCard label="Failed" value={stats.failedToday} icon={XCircle} tone={stats.failedToday > 0 ? "destructive" : "default"} />
        </div>
      </section>

      <section aria-labelledby="integrations-heading">
        <h2 id="integrations-heading" className="mb-3 text-sm font-medium">Integrations</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Connected GitHub integrations</p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums">{stats.githubConnected}</p>
            </div>
            <GithubIcon className="size-5 text-muted-foreground" />
          </Card>
          <Card className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Connected Slack integrations</p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums">{stats.slackConnected}</p>
            </div>
            <SlackIcon className="size-5" />
          </Card>
        </div>
      </section>
    </div>
  );
}
