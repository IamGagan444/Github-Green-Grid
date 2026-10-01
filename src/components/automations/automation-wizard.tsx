"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, FlaskConical, GitBranch, Lock, RefreshCw, Save, X } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

import {
  COMMIT_WINDOW_OPTIONS,
  labelFor,
  MESSAGE_STYLE_OPTIONS,
  POSTING_MODE_OPTIONS,
  THREAD_MODE_OPTIONS,
} from "@/components/automations/options";
import { GithubIcon } from "@/components/icons/github-icon";
import { SlackIcon } from "@/components/icons/slack-icon";
import { DaySelector } from "@/components/schedule/day-selector";
import { TimezoneSelector } from "@/components/schedule/timezone-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { formatScheduleTime, getNextRun, localDayKey } from "@/lib/automation/schedule";
import { apiFetch, messageFor } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";
import { formatDateTime } from "@/lib/format";
import { describeFrequency } from "@/lib/schedule/next-run";
import { timezoneLabel } from "@/lib/schedule/timezone";
import { buildDateHeader } from "@/lib/slack/message";
import { cn } from "@/lib/utils";
import { automationConfigSchema, MAX_SOURCES_PER_AUTOMATION } from "@/validators/automation";
import type { PreviewResult } from "@/services/automation-service";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { showPreview } from "@/store/slices/test-preview-slice";
import {
  goToStep,
  nextStep,
  previousStep,
  setActivate,
  setTesting,
  startWizard,
} from "@/store/slices/wizard-slice";

type FormInput = z.input<typeof automationConfigSchema>;
type FormOutput = z.output<typeof automationConfigSchema>;

export interface WizardWorkspace {
  id: string;
  teamName: string;
  status: "CONNECTED" | "DISCONNECTED" | "REVOKED";
  userPostingAvailable: boolean;
}

interface Repo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

interface Channel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

interface WizardProps {
  mode: "create" | "edit";
  automationId?: string;
  initialValues: FormInput;
  githubConnected: boolean;
  githubUsername: string | null;
  workspaces: WizardWorkspace[];
  timezones: string[];
}

type StepId = "connect" | "name" | "timing" | "message" | "thread" | "review";

const STEPS: Array<{ id: StepId; title: string; description: string; fields: FieldPath<FormInput>[] }> = [
  {
    id: "connect",
    title: "Connect GitHub & Slack",
    description: "Pick the repositories to read and the Slack channel to post in.",
    fields: ["githubSources", "slackIntegrationId", "postingMode", "slackChannelId", "slackChannelName"],
  },
  { id: "name", title: "Name", description: "What should this automation be called?", fields: ["name"] },
  {
    id: "timing",
    title: "Commit date & schedule",
    description: "Which day's commits to summarise, and when to post.",
    fields: ["commitWindow", "daysOfWeek", "scheduleTime", "timezone"],
  },
  {
    id: "message",
    title: "Message",
    description: "How Nemotron should write the update, plus optional context.",
    fields: ["messageStyle", "quickNote"],
  },
  { id: "thread", title: "Thread", description: "How should daily updates be grouped?", fields: ["threadMode", "headerFormat"] },
  { id: "review", title: "Review", description: "Check everything, test it, then save.", fields: [] },
];

function SectionHeading({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function ErrorText({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

function OptionCards<T extends string>({
  name,
  value,
  onChange,
  options,
  disabledValues = [],
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; description: string }>;
  disabledValues?: T[];
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2">
      {options.map((option) => {
        const checked = option.value === value;
        const disabled = disabledValues.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-lg border px-3.5 py-3 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              checked ? "border-primary/50 bg-primary/10" : "border-border hover:bg-secondary/50",
            )}
          >
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-xs text-muted-foreground">{option.description}</span>
          </button>
        );
      })}
    </div>
  );
}

function RefreshButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
    >
      <RefreshCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden="true" />
      Refresh
    </Button>
  );
}

export function AutomationWizard(props: WizardProps) {
  const { mode, automationId, initialValues, githubConnected, workspaces, timezones } = props;
  const router = useRouter();
  const dispatch = useAppDispatch();
  const step = useAppSelector((state) => state.wizard.step);
  const testing = useAppSelector((state) => state.wizard.testing);
  const activate = useAppSelector((state) => state.wizard.activate);

  // Reset on enter and on leave, so the next visit never flashes a stale step.
  React.useEffect(() => {
    dispatch(startWizard({ stepCount: STEPS.length }));
    return () => {
      dispatch(startWizard({ stepCount: STEPS.length }));
    };
  }, [dispatch]);

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(automationConfigSchema),
    defaultValues: initialValues,
    mode: "onTouched",
  });
  const errors = form.formState.errors;
  const values = useWatch({ control: form.control }) as FormInput;

  // ── GitHub data
  const reposQuery = useQuery({
    queryKey: queryKeys.githubRepositories,
    queryFn: () => apiFetch<{ repositories: Repo[] }>("/api/integrations/github/repositories"),
    enabled: githubConnected,
    select: (data) => data.repositories,
  });
  const repos = reposQuery.data ?? [];
  const reposLoading = githubConnected && reposQuery.isPending;
  const reposError = reposQuery.error ? messageFor(reposQuery.error) : null;

  const sources = values.githubSources ?? [];

  const branchQueries = useQueries({
    queries: sources.map((source) => ({
      queryKey: queryKeys.githubBranches(source.owner ?? "", source.name ?? ""),
      queryFn: () =>
        apiFetch<{ branches: Array<{ name: string }> }>(
          `/api/integrations/github/branches?owner=${encodeURIComponent(source.owner ?? "")}&name=${encodeURIComponent(source.name ?? "")}`,
        ),
      enabled: Boolean(source.owner && source.name),
      select: (data: { branches: Array<{ name: string }> }) => data.branches.map((branch) => branch.name),
    })),
  });
  const branchState = new Map<string, { names: string[]; loading: boolean; error: string | null }>(
    sources.map((source, index) => {
      const query = branchQueries[index];
      return [
        `${source.owner}/${source.name}`,
        {
          names: query?.data ?? [],
          loading: query?.isPending ?? false,
          error: query?.error ? messageFor(query.error) : null,
        },
      ] as const;
    }),
  );

  function addRepository(repositoryId: string) {
    const repo = repos.find((entry) => entry.id === repositoryId);
    if (!repo || sources.some((source) => source.repositoryId === repo.id)) return;
    form.setValue(
      "githubSources",
      [...sources, { repositoryId: repo.id, owner: repo.owner, name: repo.name, branch: repo.defaultBranch }],
      { shouldValidate: true, shouldDirty: true },
    );
  }

  function updateSource(index: number, branch: string | null) {
    const next = sources.map((source, i) => (i === index ? { ...source, branch } : source));
    form.setValue("githubSources", next, { shouldValidate: true, shouldDirty: true });
  }

  function removeSource(index: number) {
    form.setValue(
      "githubSources",
      sources.filter((_, i) => i !== index),
      { shouldValidate: true, shouldDirty: true },
    );
  }

  // ── Slack data
  const connectedWorkspaces = workspaces.filter((workspace) => workspace.status === "CONNECTED");
  const workspace = workspaces.find((entry) => entry.id === values.slackIntegrationId) ?? null;
  const postingMode = values.postingMode ?? "BOT";
  const slackIntegrationId = values.slackIntegrationId || null;
  // Keyed by workspace + posting identity, so switching either never shows a stale list.
  const channelsQuery = useQuery({
    queryKey: queryKeys.slackChannels(slackIntegrationId ?? "", postingMode),
    queryFn: () =>
      apiFetch<{ channels: Channel[] }>(
        `/api/integrations/slack/${encodeURIComponent(slackIntegrationId ?? "")}/channels?mode=${postingMode}`,
      ),
    enabled: Boolean(slackIntegrationId),
    select: (data) => data.channels,
  });
  const queryClient = useQueryClient();
  // The server caches these lists; ?refresh=1 bypasses that cache and re-primes it.
  function refreshRepos() {
    void queryClient.fetchQuery({
      queryKey: queryKeys.githubRepositories,
      queryFn: () => apiFetch<{ repositories: Repo[] }>("/api/integrations/github/repositories?refresh=1"),
      staleTime: 0,
    });
  }
  function refreshChannels() {
    if (!slackIntegrationId) return;
    void queryClient.fetchQuery({
      queryKey: queryKeys.slackChannels(slackIntegrationId, postingMode),
      queryFn: () =>
        apiFetch<{ channels: Channel[] }>(
          `/api/integrations/slack/${encodeURIComponent(slackIntegrationId)}/channels?mode=${postingMode}&refresh=1`,
        ),
      staleTime: 0,
    });
  }

  const channels = channelsQuery.data ?? [];
  const channelsError = channelsQuery.error ? messageFor(channelsQuery.error) : null;
  const channelsLoading = Boolean(slackIntegrationId) && channelsQuery.isPending;

  // ── Navigation
  async function next() {
    const fields = STEPS[step]?.fields ?? [];
    const valid = fields.length === 0 ? true : await form.trigger(fields);
    if (valid) dispatch(nextStep());
  }

  function back() {
    dispatch(previousStep());
  }

  async function runTest() {
    const valid = await form.trigger();
    if (!valid) {
      toast.error("Some steps have errors. Review them before testing.");
      return;
    }
    const config = form.getValues();
    dispatch(setTesting(true));
    try {
      const data = await apiFetch<{ preview: PreviewResult }>("/api/automations/test", {
        method: "POST",
        body: JSON.stringify({
          githubSources: config.githubSources,
          commitWindow: config.commitWindow,
          messageStyle: config.messageStyle,
          quickNote: config.quickNote,
          includeFileStats: config.includeFileStats,
          slackIntegrationId: config.slackIntegrationId,
          slackChannelId: config.slackChannelId,
          postingMode: config.postingMode,
          threadMode: config.threadMode,
          headerFormat: config.headerFormat,
          timezone: config.timezone,
        }),
      });
      dispatch(showPreview(data.preview));
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      dispatch(setTesting(false));
    }
  }

  async function onSubmit(output: FormOutput) {
    try {
      if (mode === "create") {
        await apiFetch("/api/automations", {
          method: "POST",
          body: JSON.stringify({ ...toPayload(output), activate }),
        });
        toast.success(activate ? "Automation created and scheduled." : "Automation created (paused).");
      } else {
        await apiFetch(`/api/automations/${automationId}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(output)),
        });
        toast.success("Automation updated.");
      }
      router.push("/automations");
      router.refresh();
    } catch (error) {
      toast.error(messageFor(error));
    }
  }

  const nextRun = React.useMemo(() => {
    try {
      if (!values.timezone || !values.scheduleTime || !values.daysOfWeek?.length) return null;
      return getNextRun({ daysOfWeek: values.daysOfWeek, scheduleTime: values.scheduleTime, timezone: values.timezone });
    } catch {
      return null;
    }
  }, [values.daysOfWeek, values.scheduleTime, values.timezone]);

  const current = STEPS[step] ?? STEPS[0]!;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
      {/* Step rail */}
      <ol className="hidden flex-col gap-0.5 lg:flex" aria-label="Steps">
        {STEPS.map((entry, index) => (
          <li key={entry.title}>
            <button
              type="button"
              onClick={() => index < step && dispatch(goToStep(index))}
              disabled={index > step}
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                index === step ? "bg-secondary font-medium" : "text-muted-foreground",
                index < step && "hover:bg-secondary/60 hover:text-foreground",
                index > step && "cursor-default opacity-60",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums",
                  index < step ? "bg-primary text-primary-foreground" : "bg-secondary",
                )}
              >
                {index + 1}
              </span>
              {entry.title}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <p className="text-xs text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </p>
          <CardTitle>{current.title}</CardTitle>
          <CardDescription>{current.description}</CardDescription>
        </CardHeader>

        <CardContent className="flex min-h-72 flex-col gap-5 pt-0">
          {current.id === "name" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Automation name</Label>
              <Input id="name" placeholder="Daily standup — #eng-updates" aria-invalid={Boolean(errors.name)} {...form.register("name")} />
              <ErrorText message={errors.name?.message} />
            </div>
          ) : null}

          {current.id === "connect" ? (
            <>
              <SectionHeading icon={<GithubIcon className="size-4" />} title="GitHub" description="Commits are read from these repositories." />
              {!githubConnected ? (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                  Connect GitHub first.{" "}
                  <a className="text-primary underline-offset-4 hover:underline" href="/api/integrations/github/connect?returnTo=/automations/new">
                    Connect GitHub
                  </a>
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="repository">Repositories</Label>
                  <RefreshButton label="Refresh repositories" busy={reposQuery.isFetching} onClick={refreshRepos} />
                </div>
                <SearchableSelect
                  id="repository"
                  value={null}
                  options={repos.map((repo) => ({
                    value: repo.id,
                    label: repo.fullName,
                    hint: repo.private ? "private" : undefined,
                    disabled: sources.some((source) => source.repositoryId === repo.id),
                  }))}
                  onChange={addRepository}
                  placeholder={
                    sources.length >= MAX_SOURCES_PER_AUTOMATION ? "Repository limit reached" : "Add a repository…"
                  }
                  searchPlaceholder="Search repositories"
                  emptyMessage={reposError ?? "No repositories found. Check the GitHub App's repository access."}
                  loading={reposLoading}
                  disabled={!githubConnected || sources.length >= MAX_SOURCES_PER_AUTOMATION}
                  aria-invalid={Boolean(errors.githubSources)}
                />
                <ErrorText message={errors.githubSources?.message ?? errors.githubSources?.root?.message} />

                <ul className="flex flex-col gap-2">
                  {sources.map((source, index) => {
                    const key = `${source.owner}/${source.name}`;
                    const branchInfo = branchState.get(key);
                    const branchOptions = [
                      { value: "__all__", label: "All branches", hint: "up to 30" },
                      ...(branchInfo?.names ?? []).map((branch) => ({ value: branch, label: branch })),
                    ];
                    return (
                      <li key={source.repositoryId} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{key}</span>
                        <div className="flex items-center gap-2 sm:w-64">
                          <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <SearchableSelect
                              value={source.branch ?? "__all__"}
                              fallbackLabel={source.branch ?? "All branches"}
                              options={branchOptions}
                              onChange={(value) => updateSource(index, value === "__all__" ? null : value)}
                              placeholder="Branch"
                              searchPlaceholder="Search branches"
                              loading={branchInfo?.loading}
                              {...(branchInfo?.error ? { emptyMessage: branchInfo.error } : {})}
                            />
                          </div>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => removeSource(index)} aria-label={`Remove ${key}`}>
                          <X aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Only commits authored by {props.githubUsername ? `@${props.githubUsername}` : "your GitHub account"} are included.
                </p>
              </div>

              <label className="flex items-start gap-2.5 text-sm">
                <Controller
                  control={form.control}
                  name="includeFileStats"
                  render={({ field }) => (
                    <Checkbox checked={Boolean(field.value)} onCheckedChange={(checked) => field.onChange(checked === true)} className="mt-0.5" />
                  )}
                />
                <span>
                  Include changed file names and line counts
                  <span className="block text-xs text-muted-foreground">Richer summaries; one extra GitHub request per commit (max 15).</span>
                </span>
              </label>
            </>
          ) : null}

          {current.id === "message" ? (
            <div className="flex flex-col gap-2">
              <Label>Message style</Label>
              <Controller
                control={form.control}
                name="messageStyle"
                render={({ field }) => (
                  <OptionCards name="Message style" value={field.value ?? "CONCISE"} onChange={field.onChange} options={MESSAGE_STYLE_OPTIONS} />
                )}
              />
            </div>
          ) : null}

          {current.id === "message" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="quickNote">Quick note (optional)</Label>
              <Textarea
                id="quickNote"
                rows={4}
                maxLength={500}
                placeholder="e.g. Pairing with Priya on the billing migration this week."
                {...form.register("quickNote")}
              />
              <ErrorText message={errors.quickNote?.message} />
              <p className="text-xs text-muted-foreground">
                Gives the AI context — it can shape wording but never adds work that isn&apos;t in your commits.
              </p>
            </div>
          ) : null}

          {current.id === "connect" ? (
            <>
              <div className="border-t border-border pt-5">
                <SectionHeading icon={<SlackIcon className="size-4" />} title="Slack" description="The update is posted in this channel." />
              </div>
              {connectedWorkspaces.length === 0 ? (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                  Connect a Slack workspace first.{" "}
                  <a className="text-primary underline-offset-4 hover:underline" href="/api/integrations/slack/connect?returnTo=/automations/new">
                    Connect Slack
                  </a>
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <Label htmlFor="workspace">Workspace</Label>
                <SearchableSelect
                  id="workspace"
                  value={values.slackIntegrationId ?? null}
                  options={connectedWorkspaces.map((entry) => ({ value: entry.id, label: entry.teamName }))}
                  onChange={(value) => {
                    form.setValue("slackIntegrationId", value, { shouldValidate: true, shouldDirty: true });
                    form.setValue("slackChannelId", "", { shouldDirty: true });
                    form.setValue("slackChannelName", "", { shouldDirty: true });
                    const selectedWorkspace = workspaces.find((entry) => entry.id === value);
                    if (!selectedWorkspace?.userPostingAvailable) form.setValue("postingMode", "BOT");
                  }}
                  placeholder="Select a workspace"
                  searchPlaceholder="Search workspaces"
                  aria-invalid={Boolean(errors.slackIntegrationId)}
                />
                <ErrorText message={errors.slackIntegrationId?.message} />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Post as</Label>
                <Controller
                  control={form.control}
                  name="postingMode"
                  render={({ field }) => (
                    <OptionCards
                      name="Posting identity"
                      value={field.value ?? "BOT"}
                      onChange={(value) => {
                        field.onChange(value);
                        form.setValue("slackChannelId", "");
                        form.setValue("slackChannelName", "");
                      }}
                      options={POSTING_MODE_OPTIONS}
                      disabledValues={workspace?.userPostingAvailable ? [] : ["USER"]}
                    />
                  )}
                />
                {workspace && !workspace.userPostingAvailable ? (
                  <p className="text-xs text-muted-foreground">
                    “Post as me” isn&apos;t enabled for this workspace yet.{" "}
                    <a
                      className="text-primary underline-offset-4 hover:underline"
                      href={`/api/integrations/slack/connect?returnTo=${encodeURIComponent(mode === "edit" && automationId ? `/automations/${automationId}/edit` : "/automations/new")}`}
                    >
                      Reconnect Slack
                    </a>{" "}
                    once to allow both.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="channel">Channel</Label>
                  {slackIntegrationId ? (
                    <RefreshButton label="Refresh channels" busy={channelsQuery.isFetching} onClick={refreshChannels} />
                  ) : null}
                </div>
                <SearchableSelect
                  id="channel"
                  value={values.slackChannelId || null}
                  fallbackLabel={values.slackChannelName ? `#${values.slackChannelName}` : undefined}
                  options={channels.map((channel) => ({
                    value: channel.id,
                    label: `${channel.isPrivate ? "🔒 " : "#"}${channel.name}`,
                    hint: channel.isMember ? undefined : channel.isPrivate ? "invite app" : "will join",
                  }))}
                  onChange={(value) => {
                    const channel = channels.find((entry) => entry.id === value);
                    form.setValue("slackChannelId", value, { shouldValidate: true, shouldDirty: true });
                    form.setValue("slackChannelName", channel?.name ?? "", { shouldValidate: true, shouldDirty: true });
                  }}
                  placeholder={values.slackIntegrationId ? "Select a channel" : "Select a workspace first"}
                  searchPlaceholder="Search channels"
                  emptyMessage={channelsError ?? "No channels visible to this identity."}
                  loading={channelsLoading}
                  disabled={!values.slackIntegrationId}
                  aria-invalid={Boolean(errors.slackChannelId)}
                />
                <ErrorText message={errors.slackChannelId?.message ?? errors.slackChannelName?.message} />
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="size-3" aria-hidden="true" />
                  Private channels appear once the app (or you, for “Post as me”) is a member.
                </p>
              </div>
            </>
          ) : null}

          {current.id === "thread" ? (
            <>
              <Controller
                control={form.control}
                name="threadMode"
                render={({ field }) => (
                  <OptionCards name="Thread style" value={field.value ?? "DATE_HEADER"} onChange={field.onChange} options={THREAD_MODE_OPTIONS} />
                )}
              />
              {(values.threadMode ?? "DATE_HEADER") === "DATE_HEADER" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="headerFormat">Date header</Label>
                  <Input id="headerFormat" aria-invalid={Boolean(errors.headerFormat)} {...form.register("headerFormat")} />
                  <ErrorText message={errors.headerFormat?.message} />
                  <p className="text-xs text-muted-foreground">
                    <code>{"{date}"}</code> becomes today&apos;s date. Preview:{" "}
                    <span className="text-foreground">
                      {buildDateHeader(safeToday(values.timezone), values.headerFormat || "📅 {date}")
                        .replace(/&amp;/g, "&")}
                    </span>
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {current.id === "timing" ? (
            <>
              <div className="flex flex-col gap-2">
                <Label>Commit date</Label>
                <Controller
                  control={form.control}
                  name="commitWindow"
                  render={({ field }) => (
                    <OptionCards name="Commit date" value={field.value ?? "SAME_DAY"} onChange={field.onChange} options={COMMIT_WINDOW_OPTIONS} />
                  )}
                />
              </div>
              <div className="flex flex-col gap-2 border-t border-border pt-5">
                <Label>Days of week</Label>
                <Controller
                  control={form.control}
                  name="daysOfWeek"
                  render={({ field }) => <DaySelector value={field.value ?? []} onChange={field.onChange} />}
                />
                <ErrorText message={errors.daysOfWeek?.message} />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="scheduleTime">Time</Label>
                  <Input id="scheduleTime" type="time" step={60} aria-invalid={Boolean(errors.scheduleTime)} {...form.register("scheduleTime")} />
                  <ErrorText message={errors.scheduleTime?.message} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Controller
                    control={form.control}
                    name="timezone"
                    render={({ field }) => <TimezoneSelector id="timezone" value={field.value} timezones={timezones} onChange={field.onChange} />}
                  />
                  <ErrorText message={errors.timezone?.message} />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {nextRun
                  ? `Next run: ${formatDateTime(nextRun.scheduledFor, values.timezone)} (${timezoneLabel(values.timezone)})`
                  : "Choose at least one day to see the next run."}
              </p>
            </>
          ) : null}

          {current.id === "review" ? <ReviewSummary values={values} workspaceName={workspace?.teamName ?? null} nextRun={nextRun?.scheduledFor ?? null} /> : null}
        </CardContent>

        <CardFooter className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={back} disabled={step === 0}>
            <ArrowLeft aria-hidden="true" />
            Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>
              Continue
              <ArrowRight aria-hidden="true" />
            </Button>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {mode === "create" ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={activate} onCheckedChange={(checked) => dispatch(setActivate(checked === true))} />
                  Start active
                </label>
              ) : null}
              <Button type="button" variant="outline" onClick={runTest} disabled={testing}>
                <FlaskConical aria-hidden="true" />
                {testing ? "Testing…" : "Test Automation"}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                <Save aria-hidden="true" />
                {form.formState.isSubmitting ? "Saving…" : "Save Automation"}
              </Button>
            </div>
          )}
        </CardFooter>
      </Card>

    </form>
  );
}

function safeToday(timezone: string | undefined): string {
  try {
    return localDayKey(new Date(), timezone || "UTC");
  } catch {
    return localDayKey(new Date(), "UTC");
  }
}

function toPayload(output: FormOutput) {
  return {
    ...output,
    // The server re-derives fullName; send only the declared fields.
    githubSources: output.githubSources.map(({ repositoryId, owner, name, branch }) => ({ repositoryId, owner, name, branch })),
  };
}

function ReviewSummary({
  values,
  workspaceName,
  nextRun,
}: {
  values: FormInput;
  workspaceName: string | null;
  nextRun: Date | null;
}) {
  const rows: Array<[string, React.ReactNode]> = [
    [
      "Repositories",
      <ul key="repos" className="flex flex-col gap-0.5">
        {(values.githubSources ?? []).map((source) => (
          <li key={source.repositoryId}>
            {source.owner}/{source.name}{" "}
            <Badge variant="outline">{source.branch ?? "all branches"}</Badge>
          </li>
        ))}
      </ul>,
    ],
    ["File statistics", values.includeFileStats ? "Included" : "Not included"],
    ["Workspace", workspaceName ?? "—"],
    ["Channel", values.slackChannelName ? `#${values.slackChannelName}` : "—"],
    ["Post as", labelFor(POSTING_MODE_OPTIONS, values.postingMode ?? "BOT")],
    ["Name", values.name],
    ["Commit date", labelFor(COMMIT_WINDOW_OPTIONS, values.commitWindow ?? "SAME_DAY")],
    [
      "Schedule",
      `${describeFrequency(values.daysOfWeek ?? [])} at ${values.scheduleTime ? formatScheduleTime(values.scheduleTime) : "—"} (${values.timezone ? timezoneLabel(values.timezone) : "—"})`,
    ],
    ["Next run", nextRun ? formatDateTime(nextRun, values.timezone) : "—"],
    ["Message style", labelFor(MESSAGE_STYLE_OPTIONS, values.messageStyle ?? "CONCISE")],
    ["Quick note", values.quickNote ? values.quickNote : <span className="text-muted-foreground">None</span>],
    ["Thread", labelFor(THREAD_MODE_OPTIONS, values.threadMode ?? "DATE_HEADER")],
    ...((values.threadMode ?? "DATE_HEADER") === "DATE_HEADER" ? [["Header", values.headerFormat ?? "📅 {date}"] as [string, React.ReactNode]] : []),
  ];

  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1 px-3.5 py-2.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

