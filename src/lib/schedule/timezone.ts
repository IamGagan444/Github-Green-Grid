/**
 * Timezone helpers built on the Intl API — no runtime dependency, and correct
 * across DST transitions. All stored timestamps are UTC; these functions convert
 * between UTC instants and wall-clock time in an IANA timezone.
 */

export const WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** Weekday order matching `Date.prototype.getUTCDay()` (0 = Sunday). */
const WEEKDAY_BY_INDEX: readonly Weekday[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: Weekday;
}

export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = partsFormatterCache.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  partsFormatterCache.set(timezone, formatter);
  return formatter;
}

const SHORT_WEEKDAY: Record<string, Weekday> = {
  Sun: "SUNDAY",
  Mon: "MONDAY",
  Tue: "TUESDAY",
  Wed: "WEDNESDAY",
  Thu: "THURSDAY",
  Fri: "FRIDAY",
  Sat: "SATURDAY",
};

/** Wall-clock representation of a UTC instant inside `timezone`. */
export function getWallClock(instant: Date, timezone: string): WallClock {
  const parts = getPartsFormatter(timezone).formatToParts(instant);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    weekday: SHORT_WEEKDAY[lookup.weekday ?? "Sun"] ?? "SUNDAY",
  };
}

/** Offset of `timezone` from UTC at `instant`, in milliseconds. */
export function getTimezoneOffsetMs(instant: Date, timezone: string): number {
  const wall = getWallClock(instant, timezone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // Discard sub-second drift so the offset is a whole number of minutes.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `timezone` to the corresponding UTC instant.
 * Handles DST by resolving the offset twice: once from a naive guess, then
 * again from the corrected instant.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = getTimezoneOffsetMs(new Date(naive), timezone);
  const firstGuess = naive - firstOffset;

  const secondOffset = getTimezoneOffsetMs(new Date(firstGuess), timezone);
  if (secondOffset === firstOffset) return new Date(firstGuess);

  return new Date(naive - secondOffset);
}

/** Local calendar day of a UTC instant inside `timezone`, as "YYYY-MM-DD". */
export function getLocalDayKey(instant: Date, timezone: string): string {
  const wall = getWallClock(instant, timezone);
  return formatDayKey(wall.year, wall.month, wall.day);
}

export function formatDayKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function weekdayFromDayKey(dayKey: string): Weekday {
  const [year, month, day] = dayKey.split("-").map(Number) as [number, number, number];
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAY_BY_INDEX[index] ?? "SUNDAY";
}

export function addDaysToDayKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatDayKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** A short, human-readable UTC offset such as "UTC+05:30". */
export function formatUtcOffset(timezone: string, instant: Date = new Date()): string {
  const offsetMinutes = getTimezoneOffsetMs(instant, timezone) / 60_000;
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(Math.round(abs % 60)).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

/** Timezones offered in the UI. Falls back to a curated list on older runtimes. */
export function listSupportedTimezones(): string[] {
  const withSupported = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const values = withSupported.supportedValuesOf?.("timeZone");
  if (values && values.length > 0) return values;
  return FALLBACK_TIMEZONES;
}

const FALLBACK_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];
