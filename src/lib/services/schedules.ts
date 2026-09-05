import "server-only";

import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getNextOccurrence } from "@/lib/schedule/next-run";
import type { Weekday } from "@/lib/schedule/timezone";
import type { CreateScheduleInput, UpdateScheduleInput } from "@/lib/validation/schemas";

export interface ScheduleWithRepository {
  id: string;
  enabled: boolean;
  timezone: string;
  commitsPerDay: number;
  daysOfWeek: Weekday[];
  commitMessage: string;
  activityPath: string;
  lastRunAt: Date | null;
  createdAt: Date;
  repository: {
    id: string;
    fullName: string;
    owner: string;
    name: string;
    defaultBranch: string;
    private: boolean;
    archived: boolean;
    canPush: boolean;
    htmlUrl: string | null;
  };
  /** Derived, never stored — recomputed whenever the schedule is read. */
  nextRunAt: Date | null;
  /** Slot the next run occupies within its local day. */
  nextSlotIndex: number | null;
}

const scheduleSelect = {
  id: true,
  enabled: true,
  timezone: true,
  commitsPerDay: true,
  daysOfWeek: true,
  commitMessage: true,
  activityPath: true,
  lastRunAt: true,
  createdAt: true,
  repository: {
    select: {
      id: true,
      fullName: true,
      owner: true,
      name: true,
      defaultBranch: true,
      private: true,
      archived: true,
      canPush: true,
      htmlUrl: true,
    },
  },
} as const;

type RawSchedule = Omit<ScheduleWithRepository, "nextRunAt" | "nextSlotIndex">;

function withNextRun(schedule: RawSchedule): ScheduleWithRepository {
  const next = schedule.enabled
    ? getNextOccurrence({
        timezone: schedule.timezone,
        commitsPerDay: schedule.commitsPerDay,
        daysOfWeek: schedule.daysOfWeek,
      })
    : null;

  return {
    ...schedule,
    nextRunAt: next?.runAt ?? null,
    nextSlotIndex: next?.slotIndex ?? null,
  };
}

export async function listSchedules(userId: string): Promise<ScheduleWithRepository[]> {
  const schedules = await prisma.schedule.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: scheduleSelect,
  });

  return schedules.map(withNextRun);
}

/** Loads a schedule, enforcing that it belongs to `userId` (IDOR guard). */
export async function getOwnedSchedule(
  userId: string,
  scheduleId: string,
): Promise<ScheduleWithRepository> {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, userId },
    select: scheduleSelect,
  });

  if (!schedule) {
    throw new ApiError("NOT_FOUND", "That schedule could not be found.");
  }

  return withNextRun(schedule);
}

async function assertOwnedWritableRepository(userId: string, repositoryId: string) {
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, userId },
    select: { id: true, archived: true, canPush: true, defaultBranch: true },
  });

  if (!repository) {
    throw new ApiError("NOT_FOUND", "That repository could not be found on your account.");
  }
  if (repository.archived) {
    throw new ApiError("FORBIDDEN", "Archived repositories cannot be automated.");
  }
  if (!repository.canPush) {
    throw new ApiError("FORBIDDEN", "You need write access to automate this repository.");
  }
  if (!repository.defaultBranch) {
    throw new ApiError("FORBIDDEN", "This repository has no default branch to commit to.");
  }

  return repository;
}

export async function createSchedule(
  userId: string,
  input: CreateScheduleInput,
): Promise<ScheduleWithRepository> {
  await assertOwnedWritableRepository(userId, input.repositoryId);

  const defaults = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { defaultCommitMessage: true },
  });

  const created = await prisma.schedule.create({
    data: {
      userId,
      repositoryId: input.repositoryId,
      enabled: input.enabled,
      timezone: input.timezone,
      commitsPerDay: input.commitsPerDay,
      daysOfWeek: input.daysOfWeek,
      commitMessage: input.commitMessage ?? defaults.defaultCommitMessage,
      ...(input.activityPath ? { activityPath: input.activityPath } : {}),
    },
    select: scheduleSelect,
  });

  return withNextRun(created);
}

export async function updateSchedule(
  userId: string,
  scheduleId: string,
  input: UpdateScheduleInput,
): Promise<ScheduleWithRepository> {
  await getOwnedSchedule(userId, scheduleId);

  if (input.repositoryId) {
    await assertOwnedWritableRepository(userId, input.repositoryId);
  }

  const updated = await prisma.schedule.update({
    where: { id: scheduleId },
    data: {
      ...(input.repositoryId === undefined ? {} : { repositoryId: input.repositoryId }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.commitsPerDay === undefined ? {} : { commitsPerDay: input.commitsPerDay }),
      ...(input.daysOfWeek === undefined ? {} : { daysOfWeek: input.daysOfWeek }),
      ...(input.commitMessage === undefined ? {} : { commitMessage: input.commitMessage }),
      ...(input.activityPath === undefined ? {} : { activityPath: input.activityPath }),
    },
    select: scheduleSelect,
  });

  return withNextRun(updated);
}

export async function deleteSchedule(userId: string, scheduleId: string): Promise<void> {
  const { count } = await prisma.schedule.deleteMany({ where: { id: scheduleId, userId } });
  if (count === 0) {
    throw new ApiError("NOT_FOUND", "That schedule could not be found.");
  }
}
