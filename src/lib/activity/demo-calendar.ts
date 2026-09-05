import { levelForCount, type CalendarDay } from "@/lib/activity/types";

/**
 * Deterministic sample data for the marketing calendar.
 *
 * Uses a fixed hash of the date string rather than Math.random so the server
 * and client render identical markup.
 */
function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result);
}

function toDayKey(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export interface DemoCalendar {
  startDate: string;
  endDate: string;
  days: CalendarDay[];
}

export function buildDemoCalendar(reference: Date = new Date(), length = 364): DemoCalendar {
  const end = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
  );
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (length - 1));

  const days: CalendarDay[] = [];

  for (
    const cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const key = toDayKey(cursor);
    const weekday = cursor.getUTCDay();
    const seed = hash(key);

    // Weekday-heavy pattern, mirroring a typical weekday automation schedule.
    const isWeekend = weekday === 0 || weekday === 6;
    const roll = seed % 100;
    let count = 0;
    if (isWeekend) count = roll < 18 ? 1 : 0;
    else if (roll < 12) count = 0;
    else if (roll < 62) count = 1;
    else if (roll < 86) count = 2;
    else count = 3;

    days.push({
      date: key,
      count,
      level: levelForCount(count),
      status: count > 0 ? "completed" : "none",
      planned: false,
    });
  }

  return { startDate: toDayKey(start), endDate: toDayKey(end), days };
}
