import "server-only";

import { localDayKey } from "@/lib/automation/schedule";
import { prisma } from "@/lib/db";
import { getGitHubIntegration } from "@/services/github-service";
import { listInstagramIntegrations } from "@/services/instagram-service";
import { listSlackIntegrations } from "@/services/slack-service";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FEED_SIZE = 10;

export type ActivityKind = "STANDUP" | "INSTAGRAM" | "COMMIT";
export type ActivityStatus = "SUCCESS" | "FAILED" | "SKIPPED" | "RUNNING";

/** One row of the combined activity feed, whatever product produced it. */
export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  status: ActivityStatus;
  at: Date;
  href: string;
}

export interface SetupStep {
  id: string;
  label: string;
  description: string;
  done: boolean;
  href: string;
  /** Plain anchor (OAuth redirect) instead of client-side navigation. */
  external?: boolean;
}

/** Everything the user dashboard renders, scoped to one user. */
export async function getUserDashboard(userId: string, timezone: string, now: Date = new Date()) {
  const today = localDayKey(now, timezone);
  const weekAgo = new Date(now.getTime() - WEEK_MS);

  const [
    standupTotal,
    standupActive,
    standupToday,
    standupRecent,
    instagramTotal,
    instagramActive,
    instagramWeek,
    instagramRecent,
    scheduleTotal,
    scheduleEnabled,
    commitsWeek,
    commitRecent,
    github,
    slack,
    instagram,
  ] = await Promise.all([
    prisma.automation.count({ where: { userId } }),
    prisma.automation.count({ where: { userId, status: "ACTIVE" } }),
    prisma.execution.groupBy({
      by: ["status"],
      where: { userId, executionDate: today },
      orderBy: { status: "asc" },
      _count: { _all: true },
    }),
    prisma.execution.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: FEED_SIZE,
      select: {
        id: true,
        automationName: true,
        executionDate: true,
        status: true,
        commitCount: true,
        startedAt: true,
        errorMessage: true,
        slackChannelName: true,
      },
    }),
    prisma.instagramAutomation.count({ where: { userId } }),
    prisma.instagramAutomation.count({ where: { userId, status: "ACTIVE" } }),
    prisma.instagramEvent.groupBy({
      by: ["status"],
      where: { integration: { userId }, type: { not: "POSTBACK" }, createdAt: { gte: weekAgo } },
      orderBy: { status: "asc" },
      _count: { _all: true },
    }),
    prisma.instagramEvent.findMany({
      where: { integration: { userId }, automationId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: FEED_SIZE,
      select: {
        id: true,
        type: true,
        status: true,
        senderUsername: true,
        errorMessage: true,
        createdAt: true,
        automation: { select: { id: true, name: true } },
      },
    }),
    prisma.schedule.count({ where: { userId } }),
    prisma.schedule.count({ where: { userId, enabled: true } }),
    prisma.activityExecution.count({ where: { userId, status: "COMPLETED", executedAt: { gte: weekAgo } } }),
    prisma.activityExecution.findMany({
      where: { userId, executedAt: { not: null } },
      orderBy: { executedAt: "desc" },
      take: FEED_SIZE,
      select: {
        id: true,
        status: true,
        executedAt: true,
        errorMessage: true,
        repository: { select: { fullName: true } },
      },
    }),
    getGitHubIntegration(userId),
    listSlackIntegrations(userId),
    listInstagramIntegrations(userId),
  ]);

  const count = (rows: Array<{ status: string; _count: { _all: number } | undefined }>, status?: string) =>
    rows
      .filter((row) => status === undefined || row.status === status)
      .reduce((sum, row) => sum + (row._count?._all ?? 0), 0);

  const slackConnected = slack.some((workspace) => workspace.status === "CONNECTED");
  const instagramConnected = instagram.some((account) => account.status === "CONNECTED");

  const feed: ActivityItem[] = [
    ...standupRecent.map((execution) => ({
      id: `s:${execution.id}`,
      kind: "STANDUP" as const,
      title: execution.automationName,
      detail: [
        execution.commitCount !== null ? `${execution.commitCount} commits` : null,
        execution.slackChannelName ? `#${execution.slackChannelName}` : null,
        execution.status === "FAILED" ? execution.errorMessage : null,
      ]
        .filter(Boolean)
        .join(" · "),
      status: execution.status,
      at: execution.startedAt,
      href: `/executions/${execution.id}`,
    })),
    ...instagramRecent.map((event) => ({
      id: `i:${event.id}`,
      kind: "INSTAGRAM" as const,
      title: event.automation?.name ?? "Instagram automation",
      detail: [
        INSTAGRAM_EVENT_LABELS[event.type],
        event.senderUsername ? `@${event.senderUsername}` : null,
        event.status === "FAILED" ? event.errorMessage : null,
      ]
        .filter(Boolean)
        .join(" · "),
      status: event.status,
      at: event.createdAt,
      href: event.automation ? `/instagram/${event.automation.id}` : "/instagram",
    })),
    ...commitRecent.map((execution) => ({
      id: `c:${execution.id}`,
      kind: "COMMIT" as const,
      title: execution.repository.fullName,
      detail: execution.status === "FAILED" ? (execution.errorMessage ?? "Failed") : "Repository activity",
      status: COMMIT_STATUS[execution.status],
      at: execution.executedAt ?? new Date(0),
      href: "/dashboard/activity",
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, FEED_SIZE);

  const setup: SetupStep[] = [
    {
      id: "github",
      label: "Connect GitHub",
      description: "Reads your commits for standups and commit activity.",
      done: github.connected,
      href: "/api/integrations/github/connect?returnTo=/dashboard",
      external: true,
    },
    {
      id: "slack",
      label: "Connect Slack",
      description: "Where your daily standups are posted.",
      done: slackConnected,
      href: "/api/integrations/slack/connect?returnTo=/dashboard",
      external: true,
    },
    {
      id: "standup",
      label: "Create a standup automation",
      description: "Pick repositories, a channel and a schedule.",
      done: standupTotal > 0,
      href: "/automations/new",
    },
    {
      id: "instagram",
      label: "Connect Instagram",
      description: "A Business or Creator account for auto-DMs.",
      done: instagramConnected,
      href: "/api/integrations/instagram/connect?returnTo=/dashboard",
      external: true,
    },
    {
      id: "instagram-automation",
      label: "Create an Instagram automation",
      description: "DM a link when someone comments a keyword.",
      done: instagramTotal > 0,
      href: "/instagram/new",
    },
  ];

  const failedToday = count(standupToday, "FAILED");
  const instagramFailedWeek = count(instagramWeek, "FAILED");

  return {
    today,
    setup,
    standups: {
      total: standupTotal,
      active: standupActive,
      runsToday: count(standupToday),
      successToday: count(standupToday, "SUCCESS"),
      failedToday,
      ready: github.connected && slackConnected,
    },
    instagram: {
      total: instagramTotal,
      active: instagramActive,
      triggeredWeek: count(instagramWeek),
      sentWeek: count(instagramWeek, "SUCCESS"),
      failedWeek: instagramFailedWeek,
      ready: instagramConnected,
      accounts: instagram,
    },
    commits: {
      total: scheduleTotal,
      enabled: scheduleEnabled,
      completedWeek: commitsWeek,
      ready: github.connected,
    },
    activeTotal: standupActive + instagramActive + scheduleEnabled,
    needsAttention:
      failedToday +
      instagramFailedWeek +
      (github.status === "REVOKED" ? 1 : 0) +
      slack.filter((workspace) => workspace.status === "REVOKED").length +
      instagram.filter((account) => account.status === "REVOKED").length,
    feed,
    github,
    slackConnected,
    slackWorkspaces: slack,
    instagramConnected,
  };
}

const INSTAGRAM_EVENT_LABELS = {
  COMMENT: "Comment",
  MESSAGE: "DM keyword",
  STORY_REPLY: "Story reply",
  STORY_MENTION: "Story mention",
  POSTBACK: "Follow check",
} as const;

const COMMIT_STATUS = {
  PENDING: "RUNNING",
  COMPLETED: "SUCCESS",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
} as const;
