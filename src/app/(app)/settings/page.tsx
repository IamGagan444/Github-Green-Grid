import type { Metadata } from "next";
import Image from "next/image";
import { KeyRound, Plus, ShieldCheck, Trash2, Unplug } from "lucide-react";

import { deleteAccountAction, disconnectGitHubAction, disconnectSlackAction } from "@/app/actions/account";
import { GithubIcon } from "@/components/icons/github-icon";
import { GoogleIcon } from "@/components/icons/google-icon";
import { SlackIcon } from "@/components/icons/slack-icon";
import { Header } from "@/components/layout/header";
import { ConfirmAction } from "@/components/settings/confirm-action";
import { SettingsForm } from "@/components/settings/settings-form";
import { IntegrationBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { listSupportedTimezones } from "@/lib/schedule/timezone";
import { listAuditLogs } from "@/services/audit-service";
import { getGitHubIntegration } from "@/services/github-service";
import { isSlackConfigured, isUserPostingOffered, listSlackIntegrations } from "@/services/slack-service";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "integrations", label: "Integrations" },
  { id: "defaults", label: "Automation defaults" },
  { id: "security", label: "Security" },
  { id: "account", label: "Account" },
];

const AUDIT_LABELS: Record<string, string> = {
  USER_LOGIN: "Signed in",
  GITHUB_CONNECTED: "Connected GitHub",
  GITHUB_DISCONNECTED: "Disconnected GitHub",
  SLACK_CONNECTED: "Connected Slack",
  SLACK_DISCONNECTED: "Disconnected Slack",
  AUTOMATION_CREATED: "Created an automation",
  AUTOMATION_UPDATED: "Updated an automation",
  AUTOMATION_PAUSED: "Paused an automation",
  AUTOMATION_RESUMED: "Resumed an automation",
  AUTOMATION_DELETED: "Deleted an automation",
  AUTOMATION_TESTED: "Tested an automation",
  AUTOMATION_EXECUTED: "Ran an automation",
  AUTOMATION_FAILED: "Automation run failed",
};

export default async function SettingsPage() {
  const user = await requireUser("settings:manage:own");

  const [preferences, github, slack, audit] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: {
        defaultTimezone: true,
        defaultCommitMessage: true,
        defaultScheduleTime: true,
        defaultDaysOfWeek: true,
        defaultMessageStyle: true,
        createdAt: true,
        lastLoginAt: true,
      },
    }),
    getGitHubIntegration(user.userId),
    listSlackIntegrations(user.userId),
    listAuditLogs({ actorUserId: user.userId, page: 1, pageSize: 10 }),
  ]);

  const slackConfigured = isSlackConfigured();
  const userPostingOffered = isUserPostingOffered();
  const githubAppSlug = process.env.GITHUB_APP_SLUG?.trim();

  return (
    <>
      <Header title="Settings" description="Your profile, integrations, defaults and account." />

      <div className="flex gap-8 px-4 py-6 sm:px-6">
        <nav aria-label="Settings sections" className="sticky top-6 hidden h-fit w-44 shrink-0 lg:block">
          <ul className="flex flex-col gap-0.5 text-sm">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex w-full max-w-3xl flex-col gap-5">
          {/* Profile */}
          <Card id="profile" className="scroll-mt-6">
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Managed by your Google account.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-4 pt-0">
              {user.image ? (
                <Image src={user.image} alt="" width={48} height={48} className="size-12 rounded-full border border-border" />
              ) : (
                <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-secondary text-sm font-medium">
                  {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name ?? "—"}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">Member since {formatDate(preferences.createdAt)}</p>
              </div>
              <Badge variant={user.role === "ADMIN" ? "warning" : "outline"}>{user.role === "ADMIN" ? "Admin" : "User"}</Badge>
            </CardContent>
          </Card>

          {/* Integrations */}
          <Card id="integrations" className="scroll-mt-6">
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>
                Tokens are encrypted with AES-256-GCM and never shown or sent to your browser. Disconnecting keeps your
                automations and history; automations pause until you reconnect.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-border pt-0">
              <IntegrationRow
                icon={<GoogleIcon className="size-5" />}
                name="Google"
                detail={user.email ?? "Signed in"}
                badge={<IntegrationBadge status="CONNECTED" />}
                actions={<p className="text-xs text-muted-foreground">Used for sign-in</p>}
              />

              <IntegrationRow
                icon={<GithubIcon className="size-5" />}
                name="GitHub"
                detail={
                  github.username
                    ? `@${github.username}${github.connectedAt ? ` · connected ${formatDate(github.connectedAt)}` : ""}`
                    : "Read commits for standups; update repositories for commit activity."
                }
                badge={<IntegrationBadge status={github.status} />}
                actions={
                  <div className="flex flex-wrap gap-2">
                    {github.connected && githubAppSlug ? (
                      <Button asChild variant="ghost" size="sm">
                        <a href={`https://github.com/apps/${encodeURIComponent(githubAppSlug)}/installations/new`} target="_blank" rel="noreferrer">
                          Manage repository access
                        </a>
                      </Button>
                    ) : null}
                    <Button asChild variant={github.connected ? "outline" : "default"} size="sm">
                      <a href="/api/integrations/github/connect?returnTo=/settings">
                        {github.connected ? "Reconnect" : github.status === "REVOKED" ? "Reconnect GitHub" : "Connect GitHub"}
                      </a>
                    </Button>
                    {github.connected ? (
                      <ConfirmAction
                        action={disconnectGitHubAction}
                        triggerLabel="Disconnect"
                        triggerIcon={<Unplug aria-hidden="true" />}
                        title="Disconnect GitHub?"
                        description="GreenGrid revokes its GitHub authorization and deletes the stored credential. Your automations and execution history are kept, but nothing runs until you reconnect."
                        confirmLabel="Disconnect GitHub"
                      />
                    ) : null}
                  </div>
                }
              />

              {slack.map((workspace) => (
                <IntegrationRow
                  key={workspace.id}
                  icon={<SlackIcon className="size-5" />}
                  name={`Slack · ${workspace.teamName}`}
                  detail={`${workspace.teamDomain ? `${workspace.teamDomain}.slack.com · ` : ""}${
                    workspace.userPostingAvailable ? "Bot and “Post as me”" : "Bot posting"
                  } · connected ${formatDate(workspace.connectedAt)}`}
                  badge={<IntegrationBadge status={workspace.status} />}
                  actions={
                    <div className="flex flex-wrap gap-2">
                      {workspace.status !== "CONNECTED" || (userPostingOffered && !workspace.userPostingAvailable) ? (
                        <Button asChild variant="outline" size="sm">
                          <a href="/api/integrations/slack/connect?returnTo=/settings">
                            {workspace.status !== "CONNECTED" ? "Reconnect" : "Reconnect to enable “Post as me”"}
                          </a>
                        </Button>
                      ) : null}
                      {workspace.status === "CONNECTED" ? (
                        <ConfirmAction
                          action={disconnectSlackAction}
                          fields={{ id: workspace.id }}
                          triggerLabel="Disconnect"
                          triggerIcon={<Unplug aria-hidden="true" />}
                          title={`Disconnect ${workspace.teamName}?`}
                          description="GreenGrid revokes its Slack tokens for this workspace. Automations posting here keep their configuration and history, but stop running until you reconnect."
                          confirmLabel="Disconnect Slack"
                        />
                      ) : null}
                    </div>
                  }
                />
              ))}

              <IntegrationRow
                icon={<SlackIcon className="size-5" />}
                name={slack.length > 0 ? "Add another Slack workspace" : "Slack"}
                detail={
                  slackConfigured
                    ? userPostingOffered
                      ? "One connection lets each automation post as the GreenGrid app or as you."
                      : "Post standups to a channel as the GreenGrid app."
                    : "Slack is not configured on this server. Ask an administrator."
                }
                badge={slack.length === 0 ? <IntegrationBadge status="NOT_CONNECTED" /> : null}
                actions={
                  slackConfigured ? (
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant={slack.length > 0 ? "outline" : "default"}>
                        <a href="/api/integrations/slack/connect?returnTo=/settings">
                          <Plus aria-hidden="true" />
                          Connect Slack
                        </a>
                      </Button>
                    </div>
                  ) : null
                }
              />
            </CardContent>
          </Card>

          {/* Defaults */}
          <SettingsForm
            timezones={listSupportedTimezones()}
            defaultValues={{
              defaultTimezone: preferences.defaultTimezone,
              defaultCommitMessage: preferences.defaultCommitMessage,
              defaultScheduleTime: preferences.defaultScheduleTime,
              defaultDaysOfWeek: preferences.defaultDaysOfWeek,
              defaultMessageStyle: preferences.defaultMessageStyle,
            }}
          />

          {/* Security */}
          <Card id="security" className="scroll-mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
                Security
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 pt-0">
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
                <li>OAuth tokens are encrypted with AES-256-GCM at rest and used only on the server.</li>
                <li>Sessions are server-side records behind an httpOnly, SameSite cookie; the database stores only a hash.</li>
                <li>Administrators can see integration status but never your tokens.</li>
                {preferences.lastLoginAt ? <li>Last sign-in: {formatDateTime(preferences.lastLoginAt, preferences.defaultTimezone)}</li> : null}
              </ul>

              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
                  Recent account activity
                </h3>
                {audit.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {audit.items.map((entry) => (
                      <li key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span>{AUDIT_LABELS[entry.action] ?? entry.action}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDateTime(entry.createdAt, preferences.defaultTimezone)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Account */}
          <Card id="account" className="scroll-mt-6 border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive">Account</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-0 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-sm text-muted-foreground">
                Deleting your account revokes GreenGrid&apos;s GitHub and Slack access and permanently deletes your
                automations, schedules and history. Messages already posted to Slack and commits already pushed to
                GitHub are not affected.
              </p>
              <ConfirmAction
                action={deleteAccountAction}
                triggerLabel="Delete account"
                triggerIcon={<Trash2 aria-hidden="true" />}
                variant="destructive"
                size="default"
                title="Delete your GreenGrid account?"
                description="This cannot be undone. All automations stop immediately and your data is deleted."
                confirmLabel="Delete account"
                pendingLabel="Deleting…"
              />
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
  badge,
  actions,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  badge: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/40">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{name}</p>
          {badge}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="shrink-0">{actions}</div>
    </div>
  );
}
