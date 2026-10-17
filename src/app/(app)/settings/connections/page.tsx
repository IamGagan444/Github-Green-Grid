import type { Metadata } from "next";
import Link from "next/link";
import { Bot, KeyRound, Mail, MessageSquare, Send, Sparkles, Trash2, Unplug } from "lucide-react";

import { deleteAiKeyAction, disconnectGoogleAction, saveAiKeyAction } from "@/app/actions/connections";
import { ActionForm } from "@/components/hub/action-form";
import { GoogleIcon } from "@/components/icons/google-icon";
import { Header } from "@/components/layout/header";
import { ConfirmAction } from "@/components/settings/confirm-action";
import { IntegrationBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AI_PROVIDER_PRESETS } from "@/lib/ai/port";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { isTelegramConfigured } from "@/lib/telegram/client";
import { getAiCredential } from "@/services/ai-credential-service";
import { getGoogleIntegration } from "@/services/google-service";
import { getUsageMeters } from "@/services/quota-service";

export const metadata: Metadata = { title: "Connections" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  connected: "Connected.",
  access_denied: "You cancelled the connection.",
  connection_failed: "The connection failed. Please try again.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  not_configured: "This integration is not configured on the server.",
  missing_state: "The connection expired. Please try again.",
  invalid_state: "The connection could not be verified. Please try again.",
  user_mismatch: "The connection was started by a different account.",
};

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("settings:manage:own");
  const query = await searchParams;
  const [google, ai, telegramChats, discordCount, meters] = await Promise.all([
    getGoogleIntegration(user.userId),
    getAiCredential(user.userId),
    prisma.notificationChannel.findMany({
      where: { userId: user.userId, kind: "TELEGRAM" },
      select: { id: true, label: true, verified: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.notificationChannel.count({ where: { userId: user.userId, kind: "DISCORD_WEBHOOK" } }),
    getUsageMeters(user.userId),
  ]);
  const telegramConfigured = isTelegramConfigured();
  const notice = query.google ? NOTICES[query.google] : query.telegram ? NOTICES[query.telegram] : undefined;

  return (
    <>
      <Header
        title="Connections"
        description="The accounts your automations use. Keys and tokens are stored encrypted and never sent to your browser."
        back={{ href: "/settings", label: "Settings" }}
      />

      <div className="flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
        {notice ? <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">{notice}</p> : null}

        {/* Telegram */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="size-4 text-primary" aria-hidden="true" />
              Telegram
            </CardTitle>
            <CardDescription>
              Get notifications, digests and approval buttons in Telegram. The button opens our bot with a one-time link that
              expires in 15 minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {telegramChats.length > 0 ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {telegramChats.map((chat) => (
                  <li key={chat.id} className="flex items-center justify-between gap-2">
                    <span>
                      {chat.label} <span className="text-xs text-muted-foreground">· linked {formatDate(chat.createdAt)}</span>
                    </span>
                    {chat.verified ? <Badge variant="success">Working</Badge> : <Badge variant="destructive">Needs attention</Badge>}
                  </li>
                ))}
              </ul>
            ) : null}
            {telegramConfigured ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm">
                  <a href="/api/integrations/telegram/connect?returnTo=/settings/connections">
                    {telegramChats.length > 0 ? "Connect another chat" : "Connect Telegram"}
                  </a>
                </Button>
                <p className="text-xs text-muted-foreground">To disconnect a chat, send /stop to the bot or remove it in the hub.</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">The Telegram bot is not configured on this server.</p>
            )}
          </CardContent>
        </Card>

        {/* Google */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GoogleIcon className="size-4" />
              Google (Sheets and Gmail)
              <IntegrationBadge status={google.status} />
            </CardTitle>
            <CardDescription>
              Separate from sign-in. GreenGrid asks only to create its own spreadsheets (drive.file) and to send email as you
              (gmail.send). It can never read your Drive files or your inbox.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {google.connected ? (
              <p className="text-sm">
                {google.email}
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · Sheets {google.canCreateSheets ? "✓" : "✗"} · Gmail {google.canSendEmail ? "✓" : "✗"}
                  {google.connectedAt ? ` · connected ${formatDate(google.connectedAt)}` : ""}
                </span>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant={google.connected ? "outline" : "default"}>
                <a href="/api/integrations/google/connect?returnTo=/settings/connections">
                  {google.connected ? "Reconnect" : google.status === "REVOKED" ? "Reconnect Google" : "Connect Google"}
                </a>
              </Button>
              {google.connected ? (
                <ConfirmAction
                  action={disconnectGoogleAction}
                  triggerLabel="Disconnect"
                  triggerIcon={<Unplug aria-hidden="true" />}
                  title="Disconnect Google?"
                  description="GreenGrid revokes its Google access. Sheets it created stay in your Drive; form, reminder and email steps pause until you reconnect."
                  confirmLabel="Disconnect Google"
                />
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Discord / Slack */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="size-4 text-primary" aria-hidden="true" />
              Discord and Slack channels
            </CardTitle>
            <CardDescription>
              {discordCount > 0 ? `${discordCount} Discord webhook${discordCount === 1 ? "" : "s"} connected. ` : ""}
              Discord webhooks and Slack channels are managed with your notification channels.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild size="sm" variant="outline">
              <Link href="/notifications?tab=channels">Manage channels</Link>
            </Button>
          </CardContent>
        </Card>

        {/* AI */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              AI key (bring your own)
            </CardTitle>
            <CardDescription>
              Digests and cross-post drafts use your own OpenAI-compatible provider. Without a key those messages are still
              sent, just without the AI summary.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            {ai ? (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">
                    {ai.label} <span className="font-normal text-muted-foreground">· {ai.model}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ai.baseUrl} · key {ai.keyHint}
                    {ai.lastVerifiedAt ? ` · verified ${formatDate(ai.lastVerifiedAt)}` : ""}
                  </p>
                </div>
                <ConfirmAction
                  action={deleteAiKeyAction}
                  triggerLabel="Remove"
                  triggerIcon={<Trash2 aria-hidden="true" />}
                  title="Remove your AI key?"
                  description="AI steps are skipped until you add a key again."
                  confirmLabel="Remove key"
                />
              </div>
            ) : null}

            <ActionForm action={saveAiKeyAction} submitLabel={ai ? "Replace key" : "Verify and save"} pendingLabel="Verifying…" icon={<KeyRound aria-hidden="true" />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ai-label">Provider name</Label>
                  <Input id="ai-label" name="label" defaultValue={ai?.label ?? AI_PROVIDER_PRESETS[0].label} maxLength={60} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ai-model">Model</Label>
                  <Input id="ai-model" name="model" defaultValue={ai?.model ?? AI_PROVIDER_PRESETS[0].model} maxLength={120} required />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ai-base">Base URL (OpenAI-compatible)</Label>
                <Input id="ai-base" name="baseUrl" type="url" defaultValue={ai?.baseUrl ?? AI_PROVIDER_PRESETS[0].baseUrl} maxLength={300} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ai-key">API key</Label>
                <Input id="ai-key" name="apiKey" type="password" autoComplete="off" placeholder={ai ? "Enter a new key to replace it" : ""} maxLength={500} required />
              </div>
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {AI_PROVIDER_PRESETS.map((preset) => (
                  <li key={preset.id}>
                    <span className="font-medium text-foreground">{preset.label}</span>: <code>{preset.baseUrl}</code> ·{" "}
                    <code>{preset.model}</code> ·{" "}
                    <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="underline">
                      get a free key
                    </a>
                  </li>
                ))}
              </ul>
            </ActionForm>
          </CardContent>
        </Card>

        {/* LinkedIn placeholder */}
        <Card className="opacity-80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
              LinkedIn
              <Badge variant="outline">With the cross-poster</Badge>
            </CardTitle>
            <CardDescription>Post to your own LinkedIn profile. Arrives with the cross-poster automation.</CardDescription>
          </CardHeader>
        </Card>

        {/* Usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-4 text-primary" aria-hidden="true" />
              Free-tier usage today
            </CardTitle>
            <CardDescription>Daily caps keep shared free quotas fair for everyone. They reset automatically.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {meters.map((meter) => {
              const percent = Math.min(100, Math.round((meter.used / meter.cap) * 100));
              return (
                <div key={meter.scope} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{meter.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {meter.used} / {meter.cap}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={meter.label}>
                    <div className={`h-full ${percent >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
