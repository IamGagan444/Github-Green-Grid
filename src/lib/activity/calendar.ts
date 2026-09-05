import "server-only";

import { prisma } from "@/lib/db";
import { getUpcomingOccurrences } from "@/lib/schedule/next-run";
import { addDaysToDayKey, getLocalDayKey } from "@/lib/schedule/timezone";
import {
  levelForCount,
  type ActivityStats,
  type CalendarDay,
  type DayStatus,
} from "@/lib/activity/types";

const CALENDAR_DAYS = 371; // 53 weeks, so the grid always starts on a Sunday.

export interface CalendarData {
  startDate: string;
  endDate: string;
  days: CalendarDay[];
  stats: ActivityStats;
}

interface DayAccumulator {
  completed: number;
  failed: number;
  skipped: number;
}

/**
 * Builds ~12 months of calendar data plus headline statistics.
 * Days are keyed in the user's primary schedule timezone so the calendar
 * matches what the schedule page shows.
 */
export async function getCalendarData(
  userId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<CalendarData> {
  const todayKey = getLocalDayKey(now, timezone);
  const startKey = addDaysToDayKey(todayKey, -(CALENDAR_DAYS - 1));

  const [executions, schedules] = await Promise.all([
    prisma.activityExecution.findMany({
      where: { userId, scheduledDay: { gte: startKey, lte: todayKey } },
      select: { scheduledDay: true, status: true },
    }),
    prisma.schedule.findMany({
      where: { userId, enabled: true },
      select: { timezone: true, commitsPerDay: true, daysOfWeek: true },
    }),
  ]);

  const byDay = new Map<string, DayAccumulator>();
  for (const execution of executions) {
    const entry = byDay.get(execution.scheduledDay) ?? { completed: 0, failed: 0, skipped: 0 };
    if (execution.status === "COMPLETED") entry.completed += 1;
    else if (execution.status === "FAILED") entry.failed += 1;
    else if (execution.status === "SKIPPED") entry.skipped += 1;
    byDay.set(execution.scheduledDay, entry);
  }

  // Planned days extend past today; the grid renders them with a distinct style.
  const plannedDays = new Set<string>();
  for (const schedule of schedules) {
    for (const occurrence of getUpcomingOccurrences(schedule, 60, now)) {
      plannedDays.add(occurrence.dayKey);
    }
  }

  const endKey = addDaysToDayKey(todayKey, 30);
  const days: CalendarDay[] = [];

  for (let cursor = startKey; cursor <= endKey; cursor = addDaysToDayKey(cursor, 1)) {
    const entry = byDay.get(cursor);
    const count = entry ? entry.completed : 0;
    const isFuture = cursor > todayKey;
    const planned = isFuture && plannedDays.has(cursor);

    let status: DayStatus = "none";
    if (entry?.completed) status = "completed";
    else if (entry?.failed) status = "failed";
    else if (entry?.skipped) status = "skipped";
    else if (planned) status = "planned";

    days.push({ date: cursor, count, level: levelForCount(count), status, planned });
  }

  return {
    startDate: startKey,
    endDate: endKey,
    days,
    stats: computeStats(byDay, plannedDays, todayKey),
  };
}

function computeStats(
  byDay: Map<string, DayAccumulator>,
  plannedDays: Set<string>,
  todayKey: string,
): ActivityStats {
  let completed = 0;
  let failed = 0;
  for (const entry of byDay.values()) {
    completed += entry.completed;
    failed += entry.failed;
  }

  // The streak may legitimately start yesterday if today's run has not fired yet.
  let streak = 0;
  let cursor = byDay.get(todayKey)?.completed ? todayKey : addDaysToDayKey(todayKey, -1);
  while (byDay.get(cursor)?.completed) {
    streak += 1;
    cursor = addDaysToDayKey(cursor, -1);
  }

  let scheduledThisWeek = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const dayKey = addDaysToDayKey(todayKey, offset);
    if (plannedDays.has(dayKey)) scheduledThisWeek += 1;
  }

  return { currentStreak: streak, scheduledThisWeek, completed, failed };
}
