import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Newspaper, Plus, Send, Trash2 } from "lucide-react";

import {
  addDigestSourceAction,
  deleteDigestSourceAction,
  saveDigestSettingsAction,
  sendDigestNowAction,
  toggleDigestSourceAction,
} from "@/app/actions/digest";
import { ActionForm, CheckboxField, NativeSelect } from "@/components/hub/action-form";
import { Header } from "@/components/layout/header";
import { ConfirmAction } from "@/components/settings/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getNextRun } from "@/lib/automation/schedule";
import { requireUser } from "@/lib/auth";
import { MAX_SOURCES_PER_USER, SOURCE_KIND_LABELS } from "@/lib/digest/sources";
import { formatDateTime } from "@/lib/format";
import { CHANNEL_KIND_LABELS } from "@/lib/hub/channel-config";
import { listSupportedTimezones, WEEKDAYS } from "@/lib/schedule/timezone";
import { listChannels } from "@/services/channel-service";
import { getDigestSetup } from "@/services/digest-service";

export const metadata: Metadata = { title: "Morning digest" };
export const dynamic = "force-dynamic";

const DAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

const SOURCE_HINTS = [
  { kind: "RSS", placeholder: "https://example.com/feed.xml", hint: "Any blog or news site's RSS or Atom feed." },
  { kind: "YOUTUBE_CHANNEL", placeholder: "UCxxxxxxxxxxxxxxxxxxxxxx", hint: "Channel ID or youtube.com/channel/UC… link." },
  { kind: "GITHUB_RELEASES", placeholder: "vercel/next.js", hint: "owner/repo. You'll see each new release." },
  { kind: "HACKER_NEWS", placeholder: "5", hint: "How many top stories to include (1–10)." },
] as const;

export default async function DigestPage() {
  const user = await requireUser("notification:manage:own");
  const [{ settings, sources, defaultTimezone }, channels] = await Promise.all([getDigestSetup(user.userId), listChannels(user.userId)]);
  const verifiedChannels = channels.filter((channel) => channel.verified);
  const timezone = settings?.timezone ?? defaultTimezone;
  const selectedDays = new Set(settings?.daysOfWeek ?? WEEKDAYS);
  const selectedChannels = new Set(settings?.channelIds ?? (verifiedChannels.length === 1 ? [verifiedChannels[0]!.id] : []));
  const nextRun =
    settings?.enabled && settings.channelIds.length > 0 && sources.some((source) => source.enabled)
      ? getNextRun({ daysOfWeek: settings.daysOfWeek, scheduleTimes: settings.scheduleTimes, timezone: settings.timezone })
      : null;

  return (
    <>
      <Header
        title="Morning digest"
        description="Blogs, YouTube channels, GitHub releases and Hacker News, rolled into one short message each morning."
        actions={
          settings && sources.length > 0 ? (
            <ActionForm
              action={sendDigestNowAction}
              submitLabel="Send now"
              pendingLabel="Building…"
              variant="outline"
              icon={<Send aria-hidden="true" />}
            />
          ) : null
        }
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        {nextRun ? (
          <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
            Next digest: <span className="font-medium">{formatDateTime(nextRun.scheduledFor, timezone)}</span>
          </p>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4 text-primary" aria-hidden="true" />
                When and where
              </CardTitle>
              <CardDescription>Pick a time and the channels it should land in. Only new items are included each day.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {verifiedChannels.length === 0 ? (
                <EmptyState
                  icon={Send}
                  title="Add a channel first"
                  description="Your digest needs somewhere to go: Telegram, WhatsApp, Slack or email."
                  className="py-8"
                  action={
                    <Button asChild size="sm">
                      <Link href="/notifications?tab=channels">Add a channel</Link>
                    </Button>
                  }
                />
              ) : (
                <ActionForm action={saveDigestSettingsAction} submitLabel="Save" pendingLabel="Saving…">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? true} className="size-4 accent-primary" />
                    Send my digest
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="digest-time">Time</Label>
                      <Input id="digest-time" name="time" type="time" defaultValue={settings?.scheduleTimes[0] ?? "08:00"} required />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="digest-tz">Time zone</Label>
                      <NativeSelect id="digest-tz" name="timezone" defaultValue={timezone}>
                        {listSupportedTimezones().map((zone) => (
                          <option key={zone} value={zone}>
                            {zone}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  </div>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">Days</legend>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((day) => (
                        <label
                          key={day}
                          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-secondary/40"
                        >
                          <input type="checkbox" name="daysOfWeek" value={day} defaultChecked={selectedDays.has(day)} className="size-4 accent-primary" />
                          {DAY_LABELS[day]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">Send to</legend>
                    {verifiedChannels.map((channel) => (
                      <CheckboxField
                        key={channel.id}
                        name="channelIds"
                        value={channel.id}
                        label={channel.label}
                        description={CHANNEL_KIND_LABELS[channel.kind]}
                        defaultChecked={selectedChannels.has(channel.id)}
                      />
                    ))}
                  </fieldset>
                </ActionForm>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Newspaper className="size-4 text-primary" aria-hidden="true" />
                Sources
              </CardTitle>
              <CardDescription>
                Up to {MAX_SOURCES_PER_USER}. Each one shows its newest few items. Add your AI key in{" "}
                <Link href="/settings/connections" className="underline">
                  Connections
                </Link>{" "}
                for a short summary on top.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 pt-0">
              {sources.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  No sources yet. Hacker News is a good first one: leave the box below at 5.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {sources.map((source) => (
                    <li key={source.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{source.label}</p>
                          <Badge variant="outline">{SOURCE_KIND_LABELS[source.kind]}</Badge>
                          {source.enabled ? null : <Badge variant="warning">Paused</Badge>}
                        </div>
                        {source.lastError ? (
                          <p className="mt-0.5 text-xs text-destructive">{source.lastError}</p>
                        ) : source.lastFetchedAt ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">Last read {formatDateTime(source.lastFetchedAt, timezone)}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <ActionForm
                          action={toggleDigestSourceAction}
                          fields={{ id: source.id, enabled: String(!source.enabled) }}
                          submitLabel={source.enabled ? "Pause" : "Resume"}
                          variant="outline"
                        />
                        <ConfirmAction
                          action={deleteDigestSourceAction}
                          fields={{ id: source.id }}
                          triggerLabel="Remove"
                          triggerIcon={<Trash2 aria-hidden="true" />}
                          title={`Remove ${source.label}?`}
                          description="It won't appear in future digests."
                          confirmLabel="Remove source"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {sources.length < MAX_SOURCES_PER_USER ? (
                <div className="flex flex-col gap-3 rounded-md border border-border p-3">
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
                    Add a source
                  </h3>
                  {SOURCE_HINTS.map((source) => (
                    <details key={source.kind} className="rounded-md border border-border p-3" open={source.kind === "HACKER_NEWS" && sources.length === 0}>
                      <summary className="cursor-pointer text-sm font-medium">{SOURCE_KIND_LABELS[source.kind]}</summary>
                      <ActionForm
                        action={addDigestSourceAction}
                        fields={{ kind: source.kind }}
                        submitLabel="Add"
                        pendingLabel="Checking…"
                        resetOnSuccess
                        className="mt-3"
                      >
                        <Input
                          name="value"
                          placeholder={source.placeholder}
                          defaultValue={source.kind === "HACKER_NEWS" ? "5" : undefined}
                          maxLength={2000}
                          required={source.kind !== "HACKER_NEWS"}
                          aria-label={SOURCE_KIND_LABELS[source.kind]}
                        />
                        <Input name="label" placeholder="Name (optional)" maxLength={60} aria-label="Name" />
                        <p className="text-xs text-muted-foreground">{source.hint}</p>
                      </ActionForm>
                    </details>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
