import "server-only";

import { localDayKey } from "@/lib/automation/schedule";
import { prisma } from "@/lib/db";
import { getGitHubIntegration } from "@/services/github-service";
import { listSlackIntegrations } from "@/services/slack-service";

/** Everything the user dashboard renders, scoped to one user. */
export async function getUserDashboard(userId: string, timezone: string, now: Date = new Date()) {
  const today = localDayKey(now, timezone);

  const [automationCount, activeCount, todayCounts, recent, github, slack, preferences] = await Promise.all([
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
      take: 6,
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
    getGitHubIntegration(userId),
    listSlackIntegrations(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { defaultTimezone: true } }),
  ]);

  const countFor = (status: string) =>
    todayCounts.find((row) => row.status === status)?._count?._all ?? 0;

  return {
    today,
    timezone: preferences?.defaultTimezone ?? timezone,
    automationCount,
    activeCount,
    executionsToday: todayCounts.reduce((sum, row) => sum + (row._count?._all ?? 0), 0),
    successfulToday: countFor("SUCCESS"),
    failedToday: countFor("FAILED"),
    recent,
    github,
    slackConnected: slack.some((workspace) => workspace.status === "CONNECTED"),
    slackWorkspaces: slack,
  };
}
