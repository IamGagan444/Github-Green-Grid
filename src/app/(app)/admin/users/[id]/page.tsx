import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { UserStatusControl } from "@/components/admin/user-status-control";
import { ExecutionTable } from "@/components/executions/execution-table";
import { AutomationStatusBadge, IntegrationBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { describeScheduleTimes } from "@/lib/automation/schedule";
import { AuthorizationError } from "@/lib/rbac";
import { timezoneLabel } from "@/lib/schedule/timezone";
import { idParamSchema } from "@/validators/automation";
import { getUserDetail } from "@/services/admin-service";
import { listExecutions } from "@/services/execution-service";

export const metadata: Metadata = { title: "User · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("user:read:all");
  const parsed = idParamSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  let user;
  try {
    user = await getUserDetail(admin, parsed.data);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  const [automations, executions] = await Promise.all([
    prisma.automation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, slackChannelName: true, scheduleTimes: true, timezone: true, lastExecutionAt: true },
    }),
    listExecutions({ userId: user.id, page: 1, pageSize: 15 }),
  ]);

  return (
    <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
      <Link href="/admin/users" className="text-xs text-muted-foreground hover:text-foreground">
        ← Users
      </Link>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{user.name ?? user.email ?? "Legacy user"}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{user.email ?? "No email (legacy GitHub sign-in)"}</p>
          </div>
          {user.id !== admin.userId ? (
            <UserStatusControl userId={user.id} label={user.email ?? user.name ?? "this user"} status={user.status} />
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4 pt-0 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Role" value={<Badge variant={user.role === "ADMIN" ? "warning" : "outline"}>{user.role}</Badge>} />
          <Fact label="Status" value={<Badge variant={user.status === "ACTIVE" ? "success" : "destructive"}>{user.status}</Badge>} />
          <Fact label="Created" value={formatDate(user.createdAt)} />
          <Fact label="Last login" value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"} />
          <Fact
            label="GitHub"
            value={
              <span className="flex items-center gap-2">
                <IntegrationBadge status={user.githubIntegration?.status ?? "NOT_CONNECTED"} />
                {user.githubIntegration ? `@${user.githubIntegration.username}` : null}
              </span>
            }
          />
          <Fact
            label="Slack"
            value={
              user.slackIntegrations.length === 0 ? (
                <IntegrationBadge status="NOT_CONNECTED" />
              ) : (
                <ul className="flex flex-col gap-1">
                  {user.slackIntegrations.map((workspace) => (
                    <li key={workspace.id} className="flex items-center gap-2">
                      <IntegrationBadge status={workspace.status} /> {workspace.teamName}
                    </li>
                  ))}
                </ul>
              )
            }
          />
          <Fact label="Automations" value={String(user._count.automations)} />
          <Fact label="Executions" value={String(user._count.executions)} />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="user-automations">
        <h2 id="user-automations" className="text-sm font-medium">Automations</h2>
        {automations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No automations.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Last run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {automations.map((automation) => (
                  <TableRow key={automation.id}>
                    <TableCell>
                      <Link href={`/automations/${automation.id}`} className="font-medium hover:underline">
                        {automation.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <AutomationStatusBadge status={automation.status} />
                    </TableCell>
                    <TableCell>#{automation.slackChannelName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {describeScheduleTimes(automation.scheduleTimes)} {timezoneLabel(automation.timezone)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {automation.lastExecutionAt ? formatDateTime(automation.lastExecutionAt) : "Never"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="user-executions">
        <h2 id="user-executions" className="text-sm font-medium">Recent executions</h2>
        {executions.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No executions.</p>
        ) : (
          <ExecutionTable rows={executions.items} basePath="/admin/executions" />
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1">{value}</div>
    </div>
  );
}
