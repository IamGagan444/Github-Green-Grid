import {
  addDaysToDayKey,
  formatDayKey,
  getWallClock,
  isValidTimezone,
  weekdayFromDayKey,
  zonedTimeToUtc,
  type Weekday,
} from "@/lib/schedule/timezone";
import { AppError } from "@/lib/errors";

/**
 * Standup automation schedule math. Pure and timezone-aware: nothing here
 * reads the server's local time zone — every conversion names an IANA zone.
 */

export interface AutomationTiming {
  daysOfWeek: readonly Weekday[];
  /** "HH:MM" wall-clock time in `timezone`. */
  scheduleTime: string;
  timezone: string;
}

export interface DueRun {
  /** Local calendar day in the automation timezone, "YYYY-MM-DD". */
  executionDate: string;
  /** UTC instant the run was scheduled for. */
  scheduledFor: Date;
}

/** How late a run may start and still count for its day (cron delays, outages). */
export const DEFAULT_GRACE_MINUTES = 6 * 60;
const MAX_LOOKAHEAD_DAYS = 8;

function assertTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new AppError("TIMEZONE_INVALID", `invalid timezone "${timezone.slice(0, 64)}"`);
  }
}

function parseTime(scheduleTime: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(scheduleTime);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new AppError("TIMEZONE_INVALID", `invalid schedule time "${scheduleTime.slice(0, 10)}"`);
  }
  return { hour, minute };
}

export function localDayKey(instant: Date, timezone: string): string {
  assertTimezone(timezone);
  const wall = getWallClock(instant, timezone);
  return formatDayKey(wall.year, wall.month, wall.day);
}

/** UTC instant of `HH:MM` on a local day. DST gaps resolve forward. */
export function runInstantFor(dateKey: string, timing: AutomationTiming): Date {
  assertTimezone(timing.timezone);
  const { hour, minute } = parseTime(timing.scheduleTime);
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  return zonedTimeToUtc(year, month, day, hour, minute, timing.timezone);
}

/** UTC instant of local midnight starting `dateKey`. */
export function localMidnight(dateKey: string, timezone: string): Date {
  assertTimezone(timezone);
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  return zonedTimeToUtc(year, month, day, 0, 0, timezone);
}

/**
 * The run that is due at `now`, if any: its scheduled instant has passed and
 * is within the grace window. Checks today and the previous local day so a
 * late-evening schedule is not missed by a poll just after midnight. When two
 * are due, the most recent wins (the idempotency key makes the older one
 * either already done or safely retried on the next tick).
 */
export function getDueRun(
  timing: AutomationTiming,
  now: Date = new Date(),
  graceMinutes = DEFAULT_GRACE_MINUTES,
): DueRun | null {
  if (timing.daysOfWeek.length === 0) return null;
  const selected = new Set(timing.daysOfWeek);
  const today = localDayKey(now, timing.timezone);
  const graceMs = graceMinutes * 60_000;

  for (const dateKey of [today, addDaysToDayKey(today, -1)]) {
    if (!selected.has(weekdayFromDayKey(dateKey))) continue;
    const scheduledFor = runInstantFor(dateKey, timing);
    const elapsed = now.getTime() - scheduledFor.getTime();
    if (elapsed >= 0 && elapsed <= graceMs) return { executionDate: dateKey, scheduledFor };
  }
  return null;
}

/** Next scheduled run strictly after `from`. */
export function getNextRun(timing: AutomationTiming, from: Date = new Date()): DueRun | null {
  if (timing.daysOfWeek.length === 0) return null;
  const selected = new Set(timing.daysOfWeek);
  let dateKey = localDayKey(from, timing.timezone);

  for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset += 1) {
    if (selected.has(weekdayFromDayKey(dateKey))) {
      const scheduledFor = runInstantFor(dateKey, timing);
      if (scheduledFor.getTime() > from.getTime()) return { executionDate: dateKey, scheduledFor };
    }
    dateKey = addDaysToDayKey(dateKey, 1);
  }
  return null;
}

export type CommitWindowMode = "SAME_DAY" | "PREVIOUS_DAY";

/**
 * The half-open UTC interval of commits an execution summarises.
 * SAME_DAY: the execution's local day. PREVIOUS_DAY: the local day before it
 * (for morning standups). Both are full local days, DST-correct.
 */
export function commitWindow(
  executionDate: string,
  timezone: string,
  mode: CommitWindowMode,
): { dateKey: string; since: Date; until: Date } {
  const dateKey = mode === "PREVIOUS_DAY" ? addDaysToDayKey(executionDate, -1) : executionDate;
  return {
    dateKey,
    since: localMidnight(dateKey, timezone),
    until: localMidnight(addDaysToDayKey(dateKey, 1), timezone),
  };
}

export function formatScheduleTime(scheduleTime: string): string {
  const { hour, minute } = parseTime(scheduleTime);
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function executionKey(automationId: string, executionDate: string): string {
  return `${automationId}:${executionDate}`;
}
