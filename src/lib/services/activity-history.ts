import "server-only";

import { prisma } from "@/lib/db";
import type { ExecutionStatus } from "@/generated/prisma/enums";
import type { ActivityQuery } from "@/lib/validation/schemas";

export interface ActivityHistoryRow {
  id: string;
  scheduledDay: string;
  scheduledFor: Date;
  executedAt: Date | null;
  durationMs: number | null;
  status: ExecutionStatus;
  trigger: string;
  commitSha: string | null;
  commitUrl: string | null;
  commitMessage: string | null;
  errorMessage: string | null;
  repository: { id: string; fullName: string };
}

export interface ActivityHistoryPage {
  rows: ActivityHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Paginated execution history, always scoped to the requesting user. */
export async function getActivityHistory(
  userId: string,
  query: ActivityQuery,
): Promise<ActivityHistoryPage> {
  const where = {
    userId,
    ...(query.status === "ALL" ? {} : { status: query.status }),
    ...(query.repositoryId ? { repositoryId: query.repositoryId } : {}),
    ...(query.from || query.to
      ? {
          scheduledDay: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.activityExecution.count({ where }),
    prisma.activityExecution.findMany({
      where,
      orderBy: { scheduledFor: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        scheduledDay: true,
        scheduledFor: true,
        executedAt: true,
        durationMs: true,
        status: true,
        trigger: true,
        commitSha: true,
        commitUrl: true,
        commitMessage: true,
        errorMessage: true,
        repository: { select: { id: true, fullName: true } },
      },
    }),
  ]);

  return {
    rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/** Executions for a single calendar day, used by the calendar day dialog. */
export async function getExecutionsForDay(
  userId: string,
  dayKey: string,
): Promise<ActivityHistoryRow[]> {
  return prisma.activityExecution.findMany({
    where: { userId, scheduledDay: dayKey },
    orderBy: { scheduledFor: "desc" },
    select: {
      id: true,
      scheduledDay: true,
      scheduledFor: true,
      executedAt: true,
      durationMs: true,
      status: true,
      trigger: true,
      commitSha: true,
      commitUrl: true,
      commitMessage: true,
      errorMessage: true,
      repository: { select: { id: true, fullName: true } },
    },
  });
}
