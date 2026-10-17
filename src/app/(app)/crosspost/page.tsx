import type { Metadata } from "next";
import Link from "next/link";
import { Eye, Plus, Repeat2, Trash2 } from "lucide-react";

import {
  addCrossPostSourceAction,
  approveCrossPostAction,
  deleteCrossPostSourceAction,
  rejectCrossPostAction,
  updateCrossPostSourceAction,
} from "@/app/actions/crosspost";
import { ActionForm, CheckboxField, NativeSelect } from "@/components/hub/action-form";
import { Header } from "@/components/layout/header";
import { ConfirmAction } from "@/components/settings/confirm-action";
import { RunStatusBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireUser } from "@/lib/auth";
import { CHANNEL_KIND_LABELS } from "@/lib/hub/channel-config";
import { isLinkedInConfigured } from "@/lib/linkedin/client";
import { listChannels } from "@/services/channel-service";
import { getCrossPostSetup } from "@/services/crosspost-service";

export const metadata: Metadata = { title: "Cross-poster" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  NEW: "Drafting",
  AWAITING_APPROVAL: "Waiting for you",
  APPROVED: "Posting",
  PUBLISHED: "Posted",
  PARTIAL: "Partly posted",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

export default async function CrossPostPage() {
  const user = await requireUser("notification:manage:own");
  const [{ sources, items, linkedin }, channels] = await Promise.all([getCrossPostSetup(user.userId), listChannels(user.userId)]);
  const working = channels.filter((channel) => channel.verified);
  const hasTelegram = working.some((channel) => channel.kind === "TELEGRAM");
  const waiting = items.filter((item) => item.status === "AWAITING_APPROVAL");
  const others = items.filter((item) => item.status !== "AWAITING_APPROVAL");

  const targetFields = (selected: { linkedin: boolean; channelIds: string[] }) => (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Post to</legend>
      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary/40">
        <input type="checkbox" name="linkedin" defaultChecked={selected.linkedin && linkedin.canPost} disabled={!linkedin.canPost} className="mt-0.5 size-4 accent-primary" />
        <span className="min-w-0">
          <span className="block font-medium">LinkedIn</span>
          <span className="block text-xs text-muted-foreground">{linkedin.canPost ? `As ${linkedin.name ?? "you"}` : "Connect LinkedIn in Connections first"}</span>
        </span>
      </label>
      {working.map((channel) => (
        <CheckboxField
          key={channel.id}
          name="channelIds"
          value={channel.id}
          label={channel.label}
          description={CHANNEL_KIND_LABELS[channel.kind]}
          defaultChecked={selected.channelIds.includes(channel.id)}
        />
      ))}
    </fieldset>
  );

  return (
    <>
      <Header
        title="Cross-poster"
        description="Publish a video or blog post once. GreenGrid drafts the LinkedIn post and the announcements, and posts when you say so."
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        {!linkedin.canPost ? (
          <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
            {isLinkedInConfigured() ? (
              <>
                <a href="/api/integrations/linkedin/connect?returnTo=/crosspost" className="underline">
                  Connect LinkedIn
                </a>{" "}
                to post there. You can still announce on your own channels without it.
              </>
            ) : (
              "LinkedIn isn't set up on this server, so posts go to your own channels only."
            )}
          </p>
        ) : null}

        {waiting.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="size-4 text-primary" aria-hidden="true" />
                Waiting for your approval
                <Badge variant="warning">{waiting.length}</Badge>
              </CardTitle>
              <CardDescription>Edit the drafts if you like, then approve. Nothing is posted until you do.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-0">
              {waiting.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 rounded-md border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={item.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">
                      {item.title}
                    </a>
                    <Badge variant="outline">{item.source.label}</Badge>
                  </div>
                  <ActionForm action={approveCrossPostAction} fields={{ id: item.id }} submitLabel="Approve and post" pendingLabel="Posting…">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`li-${item.id}`}>LinkedIn post</Label>
                        <Textarea id={`li-${item.id}`} name="linkedin" defaultValue={item.drafts?.linkedin ?? ""} rows={7} maxLength={3000} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`an-${item.id}`}>Announcement</Label>
                        <Textarea id={`an-${item.id}`} name="announcement" defaultValue={item.drafts?.announcement ?? ""} rows={3} maxLength={1000} />
                      </div>
                    </div>
                  </ActionForm>
                  <div>
                    <ActionForm action={rejectCrossPostAction} fields={{ id: item.id }} submitLabel="Reject" variant="ghost" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="size-4 text-primary" aria-hidden="true" />
                Watch a source
              </CardTitle>
              <CardDescription>
                Only things published after you add it are posted. Checked every 30 minutes.
                {hasTelegram ? " Approval requests come to Telegram with Approve and Reject buttons." : " Link Telegram to approve from your phone."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ActionForm action={addCrossPostSourceAction} submitLabel="Start watching" pendingLabel="Checking…" resetOnSuccess>
                <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="cp-kind">Type</Label>
                    <NativeSelect id="cp-kind" name="kind" defaultValue="YOUTUBE">
                      <option value="YOUTUBE">YouTube channel</option>
                      <option value="RSS">Blog (RSS)</option>
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="cp-value">Channel ID or feed URL</Label>
                    <Input id="cp-value" name="value" required maxLength={2000} placeholder="UC… or https://myblog.com/feed.xml" />
                  </div>
                </div>
                <Input name="label" placeholder="Name (optional)" maxLength={60} aria-label="Name" />
                {targetFields({ linkedin: linkedin.canPost, channelIds: [] })}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="auto" className="size-4 accent-primary" />
                  Post automatically, without asking me first
                </label>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Repeat2 className="size-4 text-primary" aria-hidden="true" />
                Watching
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {sources.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  Nothing yet. Add your YouTube channel or blog.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {sources.map((source) => (
                    <li key={source.id}>
                      <details className="rounded-md border border-border p-3">
                        <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
                          {source.label}
                          <Badge variant="outline">{source.kind === "YOUTUBE" ? "YouTube" : "Blog"}</Badge>
                          <Badge variant={source.mode === "AUTO" ? "warning" : "outline"}>{source.mode === "AUTO" ? "Automatic" : "Asks first"}</Badge>
                          {source.enabled ? null : <Badge variant="warning">Paused</Badge>}
                        </summary>
                        {source.lastError ? <p className="mt-2 text-xs text-destructive">{source.lastError}</p> : null}
                        <ActionForm action={updateCrossPostSourceAction} fields={{ id: source.id }} submitLabel="Save" className="mt-3">
                          {targetFields(source.targets)}
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" name="auto" defaultChecked={source.mode === "AUTO"} className="size-4 accent-primary" />
                            Post automatically
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" name="enabled" defaultChecked={source.enabled} className="size-4 accent-primary" />
                            Keep watching
                          </label>
                        </ActionForm>
                        <div className="mt-3">
                          <ConfirmAction
                            action={deleteCrossPostSourceAction}
                            fields={{ id: source.id }}
                            triggerLabel="Remove"
                            triggerIcon={<Trash2 aria-hidden="true" />}
                            title={`Stop watching ${source.label}?`}
                            description="Nothing already posted is touched."
                            confirmLabel="Remove"
                          />
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {others.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="divide-y divide-border rounded-md border border-border">
                {others.map((item) => (
                  <li key={item.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <a href={item.url} target="_blank" rel="noreferrer" className="truncate text-sm font-medium hover:underline">
                        {item.title}
                      </a>
                      <p className="text-xs text-muted-foreground">{item.source.label}</p>
                    </div>
                    {item.run ? (
                      <Link href={`/notifications/runs/${item.run.id}`} className="shrink-0">
                        <RunStatusBadge status={item.run.status} />
                      </Link>
                    ) : (
                      <Badge variant="outline">{STATUS_LABEL[item.status] ?? item.status}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
