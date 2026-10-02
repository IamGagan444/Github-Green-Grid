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
  /** "HH:MM" wall-clock times in `timezone`; each is one post per day. */
  scheduleTimes: readonly string[];
  timezone: string;
}

export interface DueRun {
  /** Local calendar day in the automation timezone, "YYYY-MM-DD". */
  executionDate: string;
  /** The "HH:MM" time this run belongs to. */
  slot: string;
  /** UTC instant the run was scheduled for. */
  scheduledFor: Date;
}

/** Most posts one automation may make in a local day (scheduled + Run now). */
export const MAX_RUNS_PER_DAY = 24;
/** Slot ids for "Run now" start with this, so they never collide with a time. */
export const MANUAL_SLOT_PREFIX = "manual-";

/** How late a run may start and still count for its day (cron delays, outages). */
export const DEFAULT_GRACE_MINUTES = 6 * 60;
const MAX_LOOKAHEAD_DAYS = 8;

/** Sorted, de-duplicated schedule times. */
export function normaliseScheduleTimes(times: readonly string[]): string[] {
  return [...new Set(times)].sort();
}

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
export function runInstantFor(dateKey: string, time: string, timezone: string): Date {
  assertTimezone(timezone);
  const { hour, minute } = parseTime(time);
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  return zonedTimeToUtc(year, month, day, hour, minute, timezone);
}

/** UTC instant of local midnight starting `dateKey`. */
export function localMidnight(dateKey: string, timezone: string): Date {
  assertTimezone(timezone);
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  return zonedTimeToUtc(year, month, day, 0, 0, timezone);
}

function slotsOn(dateKey: string, timing: AutomationTiming): DueRun[] {
  return normaliseScheduleTimes(timing.scheduleTimes).map((slot) => ({
    executionDate: dateKey,
    slot,
    scheduledFor: runInstantFor(dateKey, slot, timing.timezone),
  }));
}

/**
 * Every run due at `now`: its scheduled instant has passed and is within the
 * grace window. Checks today and the previous local day so a late-evening time
 * is not missed by a poll just after midnight. Oldest first — runs of one
 * automation must execute in order, because each one's commit window starts
 * where the previous post ended.
 */
export function getDueRuns(
  timing: AutomationTiming,
  now: Date = new Date(),
  graceMinutes = DEFAULT_GRACE_MINUTES,
): DueRun[] {
  if (timing.daysOfWeek.length === 0) return [];
  const selected = new Set(timing.daysOfWeek);
  const today = localDayKey(now, timing.timezone);
  const graceMs = graceMinutes * 60_000;

  return [addDaysToDayKey(today, -1), today]
    .filter((dateKey) => selected.has(weekdayFromDayKey(dateKey)))
    .flatMap((dateKey) => slotsOn(dateKey, timing))
    .filter((run) => {
      const elapsed = now.getTime() - run.scheduledFor.getTime();
      return elapsed >= 0 && elapsed <= graceMs;
    })
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

/** Next scheduled run strictly after `from`. */
export function getNextRun(timing: AutomationTiming, from: Date = new Date()): DueRun | null {
  if (timing.daysOfWeek.length === 0 || timing.scheduleTimes.length === 0) return null;
  const selected = new Set(timing.daysOfWeek);
  let dateKey = localDayKey(from, timing.timezone);

  for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset += 1) {
    if (selected.has(weekdayFromDayKey(dateKey))) {
      const next = slotsOn(dateKey, timing)
        .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
        .find((run) => run.scheduledFor.getTime() > from.getTime());
      if (next) return next;
    }
    dateKey = addDaysToDayKey(dateKey, 1);
  }
  return null;
}

export type CommitWindowMode = "SAME_DAY" | "PREVIOUS_DAY";

/**
 * A full local day of commits, [midnight, next midnight), DST-correct.
 * SAME_DAY: the execution's own day. PREVIOUS_DAY: the day before it.
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

/**
 * The commits one run summarises, so several posts a day never repeat work.
 *
 * SAME_DAY: from where the previous post of that day ended (local midnight for
 * the first) up to this run's end — its scheduled time, or "now" for Run now.
 * PREVIOUS_DAY: the whole previous day (that mode allows a single time).
 */
export function runCommitWindow(input: {
  executionDate: string;
  timezone: string;
  mode: CommitWindowMode;
  end: Date;
  /** End of the latest earlier post (or pending post) that day, if any. */
  previousEnd: Date | null;
}): { dateKey: string; since: Date; until: Date } {
  if (input.mode === "PREVIOUS_DAY") return commitWindow(input.executionDate, input.timezone, "PREVIOUS_DAY");

  const midnight = localMidnight(input.executionDate, input.timezone);
  const since =
    input.previousEnd && input.previousEnd.getTime() > midnight.getTime() ? input.previousEnd : midnight;
  return { dateKey: input.executionDate, since, until: input.end };
}

export function formatScheduleTime(scheduleTime: string): string {
  const { hour, minute } = parseTime(scheduleTime);
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** "9:00 AM, 1:00 PM and 6:00 PM", shortened for long lists. */
export function describeScheduleTimes(times: readonly string[], maxShown = 4): string {
  const formatted = normaliseScheduleTimes(times).map(formatScheduleTime);
  if (formatted.length === 0) return "—";
  if (formatted.length > maxShown) {
    return `${formatted.slice(0, maxShown - 1).join(", ")} +${formatted.length - (maxShown - 1)} more`;
  }
  if (formatted.length === 1) return formatted[0] as string;
  return `${formatted.slice(0, -1).join(", ")} and ${formatted[formatted.length - 1]}`;
}

/** Idempotency key: one post per automation, per local day, per slot. */
export function executionKey(automationId: string, executionDate: string, slot: string): string {
  return `${automationId}:${executionDate}:${slot}`;
}

export function isManualSlot(slot: string | null | undefined): boolean {
  return Boolean(slot?.startsWith(MANUAL_SLOT_PREFIX));
}
