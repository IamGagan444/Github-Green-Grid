import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, GitBranch, History, Plus, RadioTower, RefreshCw, Send, Trash2, type LucideIcon } from "lucide-react";

import {
  addDiscordChannelAction,
  addEmailChannelAction,
  addSlackChannelAction,
  createGitHubRuleAction,
  createUptimeRuleAction,
  deleteChannelAction,
  deleteRuleAction,
  syncGitHubInstallationsAction,
  testChannelAction,
  toggleRuleAction,
} from "@/app/actions/hub";
import { ActionForm, CheckboxField } from "@/components/hub/action-form";
import { SlackChannelPicker, WhenOpened } from "@/components/hub/slack-channel-picker";
import { Header } from "@/components/layout/header";
import { ConfirmAction } from "@/components/settings/confirm-action";
import { RunStatusBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { CHANNEL_KIND_LABELS } from "@/lib/hub/channel-config";
import { EVENT_TYPE_LABELS, GITHUB_EVENT_TYPES, UPTIME_EVENT_TYPES } from "@/lib/hub/rules";
import { isTelegramConfigured } from "@/lib/telegram/client";
import { cn } from "@/lib/utils";
import { listChannels } from "@/services/channel-service";
import { getGitHubIntegration } from "@/services/github-service";
import { listGitHubInstallations } from "@/services/github-webhook-service";
import { getGoogleIntegration } from "@/services/google-service";
import { listRecentRuns, listRules } from "@/services/notification-service";
import { listSlackIntegrations } from "@/services/slack-service";
import { listMonitors } from "@/services/uptime-service";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const TAB_IDS = ["rules", "channels", "github", "activity"] as const;
type TabId = (typeof TAB_IDS)[number];

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { tab: requestedTab } = await searchParams;
  const user = await requireUser("notification:manage:own");
  const [preferences, channels, rules, runs, monitors, github, installations, google, slackWorkspaces] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.userId }, select: { defaultTimezone: true } }),
    listChannels(user.userId),
    listRules(user.userId),
    listRecentRuns(user.userId, 20),
    listMonitors(user.userId),
    getGitHubIntegration(user.userId),
    listGitHubInstallations(user.userId),
    getGoogleIntegration(user.userId),
    listSlackIntegrations(user.userId),
  ]);
  const timezone = preferences?.defaultTimezone ?? "UTC";
  const verifiedChannels = channels.filter((channel) => channel.verified);
  const githubAppSlug = process.env.GITHUB_APP_SLUG?.trim();
  const connectedWorkspaces = slackWorkspaces
    .filter((workspace) => workspace.status === "CONNECTED")
    .map((workspace) => ({ id: workspace.id, teamName: workspace.teamName }));
  // Until a channel works there is nothing to route, so new users land on Channels.
  const activeTab: TabId = TAB_IDS.includes(requestedTab as TabId)
    ? (requestedTab as TabId)
    : verifiedChannels.length === 0
      ? "channels"
      : "rules";
  const tabs: Array<{ id: TabId; label: string; icon: LucideIcon; count?: number; attention?: boolean }> = [
    { id: "rules", label: "Rules", icon: BellRing, count: rules.length },
    {
      id: "channels",
      label: "Channels",
      icon: RadioTower,
      count: channels.length,
      attention: channels.some((channel) => !channel.verified),
    },
    { id: "github", label: "GitHub", icon: GitBranch, attention: installations.length === 0 },
    { id: "activity", label: "Activity", icon: History, count: runs.length },
  ];

  return (
    <>
      <Header
        title="Notification hub"
        description="Route GitHub and uptime events to Telegram, Discord, Slack or email — free channels only."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/notifications/uptime">Uptime monitors</Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        <TabNav tabs={tabs} active={activeTab} />

        {activeTab === "rules" ? (
          <Card id="rules" className="scroll-mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BellRing className="size-4 text-primary" aria-hidden="true" />
                Rules
              </CardTitle>
              <CardDescription>A rule sends matching events to the channels you pick.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-0">
              {rules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rules yet. Add a channel, then create a rule below.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {rules.map((rule) => (
                    <li key={rule.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{rule.name}</p>
                          <Badge variant="outline">{rule.source === "GITHUB" ? "GitHub" : rule.source === "UPTIME" ? "Uptime" : rule.source}</Badge>
                          {rule.enabled ? null : <Badge variant="warning">Paused</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{rule.summary}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          → {rule.channels.map((channel) => `${channel.label}${channel.verified ? "" : " (needs attention)"}`).join(", ") || "no channels"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <ActionForm
                          action={toggleRuleAction}
                          fields={{ id: rule.id, enabled: String(!rule.enabled) }}
                          submitLabel={rule.enabled ? "Pause" : "Resume"}
                          variant="outline"
                        />
                        <ConfirmAction
                          action={deleteRuleAction}
                          fields={{ id: rule.id }}
                          triggerLabel="Delete"
                          triggerIcon={<Trash2 aria-hidden="true" />}
                          title={`Delete “${rule.name}”?`}
                          description="Events stop being routed by this rule. Delivery history is kept."
                          confirmLabel="Delete rule"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {verifiedChannels.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                  <Link href="/notifications?tab=channels" className="underline">Add a working channel</Link> before creating rules.
                </p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-md border border-border p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
                      <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
                      New GitHub rule
                    </h3>
                    <ActionForm action={createGitHubRuleAction} submitLabel="Create rule" pendingLabel="Creating…" resetOnSuccess>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="gh-name">Name</Label>
                        <Input id="gh-name" name="name" defaultValue="GitHub alerts" maxLength={80} required />
                      </div>
                      <fieldset className="flex flex-col gap-1.5">
                        <legend className="mb-1.5 text-sm font-medium">Events</legend>
                        {GITHUB_EVENT_TYPES.map((type) => (
                          <CheckboxField key={type} name="events" value={type} label={EVENT_TYPE_LABELS[type] ?? type} defaultChecked={type !== "issues.opened"} />
                        ))}
                      </fieldset>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="gh-repos">Repositories (optional)</Label>
                        <Input id="gh-repos" name="repositories" placeholder="owner/repo, owner/other" maxLength={2000} />
                        <p className="text-xs text-muted-foreground">Leave empty for every repository the GitHub App can see.</p>
                      </div>
                      <ChannelPicker channels={verifiedChannels} />
                    </ActionForm>
                  </div>

                  <div className="rounded-md border border-border p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
                      <BellRing className="size-4 text-muted-foreground" aria-hidden="true" />
                      New uptime rule
                    </h3>
                    <ActionForm action={createUptimeRuleAction} submitLabel="Create rule" pendingLabel="Creating…" resetOnSuccess>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="up-name">Name</Label>
                        <Input id="up-name" name="name" defaultValue="Uptime alerts" maxLength={80} required />
                      </div>
                      <fieldset className="flex flex-col gap-1.5">
                        <legend className="mb-1.5 text-sm font-medium">Events</legend>
                        {UPTIME_EVENT_TYPES.map((type) => (
                          <CheckboxField key={type} name="events" value={type} label={EVENT_TYPE_LABELS[type] ?? type} defaultChecked />
                        ))}
                      </fieldset>
                      {monitors.length > 0 ? (
                        <fieldset className="flex flex-col gap-1.5">
                          <legend className="mb-1.5 text-sm font-medium">Monitors (none selected = all)</legend>
                          {monitors.map((monitor) => (
                            <CheckboxField key={monitor.id} name="monitorIds" value={monitor.id} label={monitor.label} description={monitor.url} />
                          ))}
                        </fieldset>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No monitors yet — <Link href="/notifications/uptime" className="underline">add a URL to watch</Link>.
                        </p>
                      )}
                      <ChannelPicker channels={verifiedChannels} />
                    </ActionForm>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {activeTab === "activity" ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4 text-primary" aria-hidden="true" />
                Recent deliveries
              </CardTitle>
              <CardDescription>Every event, form and reminder run, with per-channel results.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {runs.length === 0 ? (
                <EmptyState icon={Send} title="Nothing delivered yet" description="Deliveries appear here as events arrive." className="py-8" />
              ) : (
                <ul className="-mx-2 divide-y divide-border">
                  {runs.map((run) => (
                    <li key={run.id}>
                      <Link
                        href={`/notifications/runs/${run.id}`}
                        className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-secondary/40"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{run.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {run._count.steps} step{run._count.steps === 1 ? "" : "s"}
                            {run.status === "RUNNING" && run.nextRetryAt ? ` · retry ${formatDateTime(run.nextRetryAt, timezone)}` : ""}
                            {run.status === "FAILED" && run.errorMessage ? ` · ${run.errorMessage}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <RunStatusBadge status={run.status} />
                          <span className="text-[11px] text-muted-foreground">{formatDateTime(run.createdAt, timezone)}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {activeTab === "channels" ? (
          <Card id="channels" className="scroll-mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RadioTower className="size-4 text-primary" aria-hidden="true" />
                Channels
              </CardTitle>
              <CardDescription>Where messages go. Each one is tested when you add it.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 pt-0 lg:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-sm font-medium">Your channels</h3>
                {channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No channels yet.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {channels.map((channel) => (
                      <li key={channel.id} className="flex flex-col gap-2 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{channel.label}</p>
                            <p className="text-xs text-muted-foreground">{CHANNEL_KIND_LABELS[channel.kind]}</p>
                          </div>
                          {channel.verified ? <Badge variant="success">Working</Badge> : <Badge variant="destructive">Needs attention</Badge>}
                        </div>
                        {channel.lastError ? <p className="text-xs text-destructive">{channel.lastError}</p> : null}
                        <div className="flex flex-wrap gap-2">
                          <ActionForm action={testChannelAction} fields={{ id: channel.id }} submitLabel="Send test" pendingLabel="Sending…" variant="outline" />
                          <ConfirmAction
                            action={deleteChannelAction}
                            fields={{ id: channel.id }}
                            triggerLabel="Remove"
                            triggerIcon={<Trash2 aria-hidden="true" />}
                            title={`Remove ${channel.label}?`}
                            description="Rules stop sending here. Other channels on those rules keep working."
                            confirmLabel="Remove channel"
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Telegram</h3>
                  {isTelegramConfigured() ? (
                    <Button asChild size="sm" variant="outline">
                      <a href="/api/integrations/telegram/connect?returnTo=/notifications">
                        <Plus aria-hidden="true" />
                        Connect a Telegram chat
                      </a>
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">The Telegram bot is not configured on this server.</p>
                  )}
                </div>
  
                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Add a Discord webhook</summary>
                  <ActionForm action={addDiscordChannelAction} submitLabel="Add Discord channel" pendingLabel="Testing…" resetOnSuccess className="mt-3">
                    <Input name="label" placeholder="#alerts on my server" maxLength={60} required aria-label="Name" />
                    <Input name="webhookUrl" placeholder="https://discord.com/api/webhooks/…" maxLength={300} required aria-label="Webhook URL" />
                    <p className="text-xs text-muted-foreground">Discord: Server settings → Integrations → Webhooks → New webhook → Copy URL.</p>
                  </ActionForm>
                </details>
  
                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Add a Slack channel</summary>
                  {connectedWorkspaces.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      <Link href="/settings#integrations" className="underline">Connect Slack</Link> first.
                    </p>
                  ) : (
                    <ActionForm action={addSlackChannelAction} submitLabel="Add Slack channel" pendingLabel="Checking…" resetOnSuccess className="mt-3">
                      <WhenOpened>
                        <SlackChannelPicker workspaces={connectedWorkspaces} />
                      </WhenOpened>
                    </ActionForm>
                  )}
                </details>
  
                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Add an email address</summary>
                  {google.canSendEmail ? (
                    <ActionForm action={addEmailChannelAction} submitLabel="Add email channel" pendingLabel="Sending test…" resetOnSuccess className="mt-3">
                      <Input name="to" type="email" defaultValue={google.email ?? ""} required aria-label="Email address" />
                      <Input name="label" placeholder="Label (optional)" maxLength={60} aria-label="Label" />
                      <p className="text-xs text-muted-foreground">Sent from your own Gmail ({google.email}).</p>
                    </ActionForm>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">
                      <Link href="/settings/connections" className="underline">Connect Google</Link> with Gmail sending first.
                    </p>
                  )}
                </details>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {activeTab === "github" ? (
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="size-4 text-primary" aria-hidden="true" />
                GitHub events
              </CardTitle>
              <CardDescription>Events arrive through the GreenGrid GitHub App installed on your repositories.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              {installations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No installations linked to your account yet.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {installations.map((installation) => (
                    <li key={installation.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {installation.accountLogin}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {installation.repositorySelection === "all" ? "all repositories" : "selected repositories"}
                        </span>
                      </span>
                      {installation.suspendedAt ? <Badge variant="warning">Suspended</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {githubAppSlug ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={`https://github.com/apps/${encodeURIComponent(githubAppSlug)}/installations/new`} target="_blank" rel="noreferrer">
                      Install on repositories
                    </a>
                  </Button>
                ) : null}
                {github.connected ? (
                  <ActionForm
                    action={syncGitHubInstallationsAction}
                    submitLabel="Refresh"
                    pendingLabel="Refreshing…"
                    variant="ghost"
                    icon={<RefreshCw aria-hidden="true" />}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    <a href="/api/integrations/github/connect?returnTo=/notifications" className="underline">Connect GitHub</a> so installations
                    can be linked to you.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

/** Link-based tabs: the active tab lives in `?tab=`, so it is shareable and survives form submissions. */
function TabNav({
  tabs,
  active,
}: {
  tabs: Array<{ id: TabId; label: string; icon: LucideIcon; count?: number; attention?: boolean }>;
  active: TabId;
}) {
  return (
    <nav aria-label="Notification hub sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max min-w-full gap-1 border-b border-border">
        {tabs.map((tab) => {
          const selected = tab.id === active;
          const Icon = tab.icon;
          return (
            <li key={tab.id}>
              <Link
                href={`/notifications?tab=${tab.id}`}
                aria-current={selected ? "page" : undefined}
                scroll={false}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  selected
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {tab.label}
                {tab.count ? (
                  <span className="rounded-full bg-secondary px-1.5 text-[11px] leading-5 text-secondary-foreground tabular-nums">{tab.count}</span>
                ) : null}
                {tab.attention ? <span className="size-1.5 rounded-full bg-warning" aria-label="Needs attention" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ChannelPicker({ channels }: { channels: Array<{ id: string; label: string; kind: keyof typeof CHANNEL_KIND_LABELS }> }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Send to</legend>
      {channels.map((channel) => (
        <CheckboxField
          key={channel.id}
          name="channelIds"
          value={channel.id}
          label={channel.label}
          description={CHANNEL_KIND_LABELS[channel.kind]}
          defaultChecked={channels.length === 1}
        />
      ))}
    </fieldset>
  );
}
