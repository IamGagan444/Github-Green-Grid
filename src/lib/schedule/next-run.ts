import {
  addDaysToDayKey,
  formatDayKey,
  getWallClock,
  weekdayFromDayKey,
  zonedTimeToUtc,
  type Weekday,
} from "@/lib/schedule/timezone";

export const MIN_COMMITS_PER_DAY = 1;
export const MAX_COMMITS_PER_DAY = 20;

/**
 * Preferred hour for the first commit of the day, in the schedule's timezone.
 * Higher commit counts start earlier so that every slot still lands inside the
 * same local calendar day — which is what GitHub's contribution graph buckets by.
 */
const PREFERRED_START_HOUR = 9;

export interface ScheduleTiming {
  timezone: string;
  commitsPerDay: number;
  daysOfWeek: readonly Weekday[];
}

export interface ScheduleOccurrence {
  /** Local calendar day, "YYYY-MM-DD", in the schedule timezone. */
  dayKey: string;
  /** 0-based position within the day; part of the idempotency key. */
  slotIndex: number;
  /** UTC instant the occurrence fires at. */
  runAt: Date;
}

const MAX_LOOKAHEAD_DAYS = 366;

export function clampCommitsPerDay(value: number): number {
  if (!Number.isFinite(value)) return MIN_COMMITS_PER_DAY;
  return Math.min(MAX_COMMITS_PER_DAY, Math.max(MIN_COMMITS_PER_DAY, Math.trunc(value)));
}

/**
 * Local hours at which the day's commits fire — one per hour, contiguous.
 *
 * 1 commit  -> [9]
 * 5 commits -> [9, 10, 11, 12, 13]
 * 20 commits -> [4 … 23]
 *
 * The window slides earlier only as far as needed, so it never wraps past
 * midnight and every commit is attributed to the same local day.
 */
export function getSlotHours(commitsPerDay: number): number[] {
  const count = clampCommitsPerDay(commitsPerDay);
  const startHour = Math.max(0, Math.min(PREFERRED_START_HOUR, 24 - count));
  return Array.from({ length: count }, (_, index) => startHour + index);
}

function slotToUtc(dayKey: string, hour: number, timezone: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number) as [number, number, number];
  return zonedTimeToUtc(year, month, day, hour, 0, timezone);
}

/** Every occurrence of one local day, in chronological order. */
export function getOccurrencesForDay(
  timing: ScheduleTiming,
  dayKey: string,
): ScheduleOccurrence[] {
  return getSlotHours(timing.commitsPerDay).map((hour, slotIndex) => ({
    dayKey,
    slotIndex,
    runAt: slotToUtc(dayKey, hour, timing.timezone),
  }));
}

/**
 * Next occurrence strictly after `from` (default: now).
 * Returns null when the schedule has no selected days.
 */
export function getNextOccurrence(
  timing: ScheduleTiming,
  from: Date = new Date(),
): ScheduleOccurrence | null {
  if (timing.daysOfWeek.length === 0) return null;

  const selected = new Set<Weekday>(timing.daysOfWeek);
  const wall = getWallClock(from, timing.timezone);
  let dayKey = formatDayKey(wall.year, wall.month, wall.day);

  for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset += 1) {
    if (selected.has(weekdayFromDayKey(dayKey))) {
      for (const occurrence of getOccurrencesForDay(timing, dayKey)) {
        if (occurrence.runAt.getTime() > from.getTime()) return occurrence;
      }
    }
    dayKey = addDaysToDayKey(dayKey, 1);
  }

  return null;
}

/**
 * Occurrences that are due at `now` — their fire time has passed and still sits
 * inside `graceMinutes`. Several can be returned at once when a cron tick was
 * missed; duplicates are rejected downstream by the execution idempotency key,
 * so a delayed poll catches up rather than silently dropping commits.
 */
export function getDueOccurrences(
  timing: ScheduleTiming,
  now: Date = new Date(),
  graceMinutes = 90,
): ScheduleOccurrence[] {
  if (timing.daysOfWeek.length === 0) return [];

  const selected = new Set<Weekday>(timing.daysOfWeek);
  const wall = getWallClock(now, timing.timezone);
  const graceMs = graceMinutes * 60_000;
  const due: ScheduleOccurrence[] = [];

  // Today plus the previous local day, so slots near midnight are not missed.
  let dayKey = formatDayKey(wall.year, wall.month, wall.day);

  for (let offset = 0; offset < 2; offset += 1) {
    if (selected.has(weekdayFromDayKey(dayKey))) {
      for (const occurrence of getOccurrencesForDay(timing, dayKey)) {
        const elapsed = now.getTime() - occurrence.runAt.getTime();
        if (elapsed >= 0 && elapsed <= graceMs) due.push(occurrence);
      }
    }
    dayKey = addDaysToDayKey(dayKey, -1);
  }

  return due.sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
}

/** Upcoming occurrences, used to render planned days on the calendar. */
export function getUpcomingOccurrences(
  timing: ScheduleTiming,
  count: number,
  from: Date = new Date(),
): ScheduleOccurrence[] {
  const occurrences: ScheduleOccurrence[] = [];
  let cursor = from;

  for (let index = 0; index < count; index += 1) {
    const next = getNextOccurrence(timing, cursor);
    if (!next) break;
    occurrences.push(next);
    cursor = next.runAt;
  }

  return occurrences;
}

const DAY_LABELS: Record<Weekday, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

const WEEKDAY_SET: readonly Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
];

/** "Every weekday", "Every day", "Mon, Wed, Fri" — for schedule summaries. */
export function describeFrequency(daysOfWeek: readonly Weekday[]): string {
  if (daysOfWeek.length === 0) return "No days selected";
  if (daysOfWeek.length === 7) return "Every day";

  const selected = new Set(daysOfWeek);
  if (
    selected.size === WEEKDAY_SET.length &&
    WEEKDAY_SET.every((day) => selected.has(day))
  ) {
    return "Every weekday";
  }
  if (selected.size === 2 && selected.has("SATURDAY") && selected.has("SUNDAY")) {
    return "Weekends";
  }

  const ordered: Weekday[] = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ];
  return ordered
    .filter((day) => selected.has(day))
    .map((day) => DAY_LABELS[day])
    .join(", ");
}

function formatHour(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return display + ":00 " + suffix;
}

/** "1 commit at 9:00 AM" / "20 commits, hourly from 4:00 AM to 11:00 PM". */
export function describeCommitWindow(commitsPerDay: number): string {
  const hours = getSlotHours(commitsPerDay);
  const first = hours[0];
  const last = hours[hours.length - 1];
  if (first === undefined || last === undefined) return "No commits scheduled";

  if (hours.length === 1) return "1 commit at " + formatHour(first);
  return (
    hours.length + " commits, hourly from " + formatHour(first) + " to " + formatHour(last)
  );
}

export { DAY_LABELS, formatHour };
