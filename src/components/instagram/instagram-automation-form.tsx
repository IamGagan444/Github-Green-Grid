"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Check, Loader2, MessageCircle, MessagesSquare, RefreshCw, Reply } from "lucide-react";
import { toast } from "sonner";

import { DmPreview } from "@/components/instagram/dm-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiRequestError, messageFor } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";
import { cn } from "@/lib/utils";

export type TriggerValue = "COMMENT" | "DM_KEYWORD" | "STORY_REPLY" | "STORY_MENTION";
export type MatchValue = "CONTAINS" | "EXACT" | "ANY";

export interface InstagramAutomationFormValues {
  integrationId: string;
  name: string;
  trigger: TriggerValue;
  mediaIds: string[];
  matchMode: MatchValue;
  keywords: string[];
  publicReplyEnabled: boolean;
  publicReplies: string[];
  dmMessage: string;
  linkUrl: string | null;
  linkButtonLabel: string;
  followGateEnabled: boolean;
  followGateMessage: string;
  followButtonLabel: string;
}

interface AccountOption {
  id: string;
  username: string;
}

interface MediaItem {
  id: string;
  caption: string | null;
  mediaType: string;
  productType: string | null;
  thumbnailUrl: string | null;
  timestamp: string;
}

const TRIGGERS: Array<{ value: TriggerValue; label: string; description: string; icon: React.ElementType }> = [
  { value: "COMMENT", label: "Comment", description: "Someone comments a keyword on a post or reel", icon: MessageCircle },
  { value: "DM_KEYWORD", label: "DM keyword", description: "Someone sends you a DM with a keyword", icon: MessagesSquare },
  { value: "STORY_REPLY", label: "Story reply", description: "Someone replies to your story", icon: Reply },
  { value: "STORY_MENTION", label: "Story mention", description: "Someone mentions you in their story", icon: AtSign },
];

export const DEFAULT_VALUES: Omit<InstagramAutomationFormValues, "integrationId"> = {
  name: "",
  trigger: "COMMENT",
  mediaIds: [],
  matchMode: "CONTAINS",
  keywords: [],
  publicReplyEnabled: true,
  publicReplies: ["Sent! Check your DMs 📩", "Just sent it to your inbox 🙌", "Check your DMs 💌"],
  dmMessage: "Hey! Here's the link you asked for 👇",
  linkUrl: null,
  linkButtonLabel: "Open link",
  followGateEnabled: false,
  followGateMessage: "Follow us first, then tap the button below to get the link 👇",
  followButtonLabel: "I'm following ✅",
};

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function InstagramAutomationForm({
  accounts,
  automationId,
  initial,
}: {
  accounts: AccountOption[];
  automationId?: string;
  initial: InstagramAutomationFormValues;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState(initial);
  const [keywordDraft, setKeywordDraft] = React.useState(initial.keywords.join(", "));
  const [repliesDraft, setRepliesDraft] = React.useState(initial.publicReplies.join("\n"));
  const [allPosts, setAllPosts] = React.useState(initial.mediaIds.length === 0);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof InstagramAutomationFormValues>(key: K, value: InstagramAutomationFormValues[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const isComment = values.trigger === "COMMENT";
  const usesKeywords = values.trigger !== "STORY_MENTION";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});

    const payload: InstagramAutomationFormValues = {
      ...values,
      mediaIds: isComment && !allPosts ? values.mediaIds : [],
      keywords: keywordDraft
        .split(/[,\n]/)
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      matchMode: usesKeywords ? values.matchMode : "ANY",
      publicReplyEnabled: isComment && values.publicReplyEnabled,
      publicReplies: repliesDraft
        .split("\n")
        .map((reply) => reply.trim())
        .filter(Boolean),
      linkUrl: values.linkUrl?.trim() ? values.linkUrl.trim() : null,
    };

    try {
      const data = await apiFetch<{ automation: { id: string } }>(
        automationId ? `/api/instagram/automations/${automationId}` : "/api/instagram/automations",
        { method: automationId ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      toast.success(automationId ? "Automation saved." : "Automation created. It's live now.");
      router.push(`/instagram/${data.automation.id}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "VALIDATION_ERROR") {
        toast.error("Please fix the highlighted fields.");
      } else {
        toast.error(messageFor(error));
      }
      setErrors(fieldErrors(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="ig-name" error={errors.name}>
                <Input
                  id="ig-name"
                  value={values.name}
                  onChange={(event) => set("name", event.target.value)}
                  placeholder="Reel: free guide"
                  maxLength={80}
                  required
                />
              </Field>
              <Field label="Instagram account" error={errors.integrationId}>
                <Select value={values.integrationId} onValueChange={(value) => set("integrationId", value)}>
                  <SelectTrigger aria-label="Instagram account">
                    <SelectValue placeholder="Choose an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        @{account.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trigger</CardTitle>
            <CardDescription>What starts the automation.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div role="radiogroup" aria-label="Trigger" className="grid gap-2 sm:grid-cols-2">
              {TRIGGERS.map((trigger) => {
                const Icon = trigger.icon;
                const selected = values.trigger === trigger.value;
                return (
                  <button
                    key={trigger.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => set("trigger", trigger.value)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      selected ? "border-primary bg-primary/5" : "border-border hover:bg-secondary",
                    )}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="block text-sm font-medium">{trigger.label}</span>
                      <span className="block text-xs text-muted-foreground">{trigger.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {isComment ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="ig-all-posts">Any post or reel</Label>
                  <Switch id="ig-all-posts" checked={allPosts} onCheckedChange={setAllPosts} />
                </div>
                {!allPosts ? (
                  <MediaPicker
                    integrationId={values.integrationId}
                    selected={values.mediaIds}
                    onChange={(ids) => set("mediaIds", ids)}
                  />
                ) : null}
                {errors.mediaIds ? <p className="text-xs text-destructive">{errors.mediaIds}</p> : null}
              </div>
            ) : null}

            {usesKeywords ? (
              <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                <Field label="Match">
                  <Select value={values.matchMode} onValueChange={(value) => set("matchMode", value as MatchValue)}>
                    <SelectTrigger aria-label="Keyword match">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CONTAINS">Contains keyword</SelectItem>
                      <SelectItem value="EXACT">Is exactly</SelectItem>
                      <SelectItem value="ANY">Any text</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {values.matchMode !== "ANY" ? (
                  <Field
                    label="Keywords"
                    htmlFor="ig-keywords"
                    hint="Comma-separated. Case and accents are ignored. e.g. link, guide, info"
                    error={errors.keywords}
                  >
                    <Input
                      id="ig-keywords"
                      value={keywordDraft}
                      onChange={(event) => setKeywordDraft(event.target.value)}
                      placeholder="link, guide"
                    />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Direct message</CardTitle>
            <CardDescription>
              {isComment
                ? "Sent as a private reply to the comment. Instagram allows one per comment, within 7 days. People who don't follow you get it in Message Requests."
                : "Sent right away in the conversation."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Message" htmlFor="ig-dm" error={errors.dmMessage}>
              <Textarea
                id="ig-dm"
                value={values.dmMessage}
                onChange={(event) => set("dmMessage", event.target.value)}
                rows={3}
                maxLength={640}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <Field label="Link (optional)" htmlFor="ig-link" error={errors.linkUrl} hint="Sent as a button. Clicks are counted.">
                <Input
                  id="ig-link"
                  type="url"
                  inputMode="url"
                  value={values.linkUrl ?? ""}
                  onChange={(event) => set("linkUrl", event.target.value)}
                  placeholder="https://example.com/guide"
                />
              </Field>
              <Field label="Button label" htmlFor="ig-link-label" error={errors.linkButtonLabel}>
                <Input
                  id="ig-link-label"
                  value={values.linkButtonLabel}
                  onChange={(event) => set("linkButtonLabel", event.target.value)}
                  maxLength={20}
                />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="ig-follow-gate">Ask to follow first</Label>
                <p className="text-xs text-muted-foreground">
                  The link is sent only after they tap the button and Instagram confirms they follow you.
                </p>
              </div>
              <Switch
                id="ig-follow-gate"
                checked={values.followGateEnabled}
                onCheckedChange={(checked) => set("followGateEnabled", checked)}
              />
            </div>
            {values.followGateEnabled ? (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                <Field label="Follow request message" htmlFor="ig-gate-message" error={errors.followGateMessage}>
                  <Textarea
                    id="ig-gate-message"
                    value={values.followGateMessage}
                    onChange={(event) => set("followGateMessage", event.target.value)}
                    rows={2}
                    maxLength={640}
                  />
                </Field>
                <Field label="Button label" htmlFor="ig-gate-label" error={errors.followButtonLabel}>
                  <Input
                    id="ig-gate-label"
                    value={values.followButtonLabel}
                    onChange={(event) => set("followButtonLabel", event.target.value)}
                    maxLength={20}
                  />
                </Field>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {isComment ? (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <CardTitle>Public reply</CardTitle>
                <CardDescription>Reply under the comment too. One line per variant, picked at random.</CardDescription>
              </div>
              <Switch
                aria-label="Public reply"
                checked={values.publicReplyEnabled}
                onCheckedChange={(checked) => set("publicReplyEnabled", checked)}
              />
            </CardHeader>
            {values.publicReplyEnabled ? (
              <CardContent>
                <Field label="Replies" htmlFor="ig-replies" error={errors.publicReplies}>
                  <Textarea
                    id="ig-replies"
                    value={repliesDraft}
                    onChange={(event) => setRepliesDraft(event.target.value)}
                    rows={4}
                  />
                </Field>
              </CardContent>
            ) : null}
          </Card>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !values.integrationId}>
            {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
            {automationId ? "Save changes" : "Create automation"}
          </Button>
        </div>
      </div>

      <aside className="lg:sticky lg:top-6 lg:h-fit">
        <DmPreview
          username={accounts.find((account) => account.id === values.integrationId)?.username ?? "you"}
          message={values.followGateEnabled ? values.followGateMessage : values.dmMessage}
          buttonLabel={
            values.followGateEnabled ? values.followButtonLabel : values.linkUrl?.trim() ? values.linkButtonLabel : null
          }
        />
      </aside>
    </form>
  );
}

/** Maps a VALIDATION_ERROR response's issues to field errors. */
function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiRequestError)) return {};
  const details = error.details as { issues?: Array<{ path: string; message: string }> } | undefined;
  const result: Record<string, string> = {};
  for (const issue of details?.issues ?? []) {
    const key = issue.path.split(".")[0] ?? "";
    if (key && !result[key]) result[key] = issue.message;
  }
  return result;
}

function MediaPicker({
  integrationId,
  selected,
  onChange,
}: {
  integrationId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const mediaUrl = `/api/instagram/media?integrationId=${encodeURIComponent(integrationId)}`;
  const mediaQuery = useQuery({
    queryKey: queryKeys.instagramMedia(integrationId),
    queryFn: () => apiFetch<{ media: MediaItem[] }>(mediaUrl),
    enabled: Boolean(integrationId),
    select: (data) => data.media,
  });
  // The server caches the list; ?refresh=1 bypasses that cache and re-primes it.
  function refresh() {
    void queryClient.fetchQuery({
      queryKey: queryKeys.instagramMedia(integrationId),
      queryFn: () => apiFetch<{ media: MediaItem[] }>(`${mediaUrl}&refresh=1`),
      staleTime: 0,
    });
  }
  const media = mediaQuery.data ?? null;
  const loading = mediaQuery.isFetching;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {selected.length === 0 ? "Choose one or more posts." : `${selected.length} selected`}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {mediaQuery.error ? (
        <p className="text-sm text-destructive">{messageFor(mediaQuery.error)}</p>
      ) : media === null ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="aspect-square animate-pulse rounded-md bg-secondary" />
          ))}
        </div>
      ) : media.length === 0 ? (
        <p className="text-sm text-muted-foreground">No posts found on this account.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {media.map((item) => {
            const isSelected = selected.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isSelected}
                title={item.caption ?? undefined}
                onClick={() => toggle(item.id)}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-md border-2 bg-secondary",
                  isSelected ? "border-primary" : "border-transparent",
                )}
              >
                {item.thumbnailUrl ? (
                  // Instagram CDN URLs are signed and short-lived; next/image would cache them.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnailUrl} alt={item.caption?.slice(0, 80) ?? "Instagram post"} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center p-1 text-[10px] text-muted-foreground">
                    {item.caption?.slice(0, 40) ?? item.mediaType}
                  </span>
                )}
                {item.productType === "REELS" ? (
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">Reel</span>
                ) : null}
                {isSelected ? (
                  <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
