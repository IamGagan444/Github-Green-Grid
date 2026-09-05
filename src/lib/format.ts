/** Presentation helpers shared by server and client components. */

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

export function formatDate(value: Date | string, timezone?: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    ...DATE_FORMAT,
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
}

export function formatDateTime(value: Date | string, timezone?: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const options: Intl.DateTimeFormatOptions = {
    ...DATE_FORMAT,
    ...TIME_FORMAT,
    ...(timezone ? { timeZone: timezone } : {}),
  };
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  if (durationMs < 1000) return durationMs + "ms";
  return (durationMs / 1000).toFixed(1) + "s";
}

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}

/** "Today", "Tomorrow", or a formatted date, relative to `reference`. */
export function describeRelativeDay(
  target: Date,
  timezone: string,
  reference: Date = new Date(),
): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const targetKey = formatter.format(target);
  const todayKey = formatter.format(reference);

  const tomorrow = new Date(reference.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowKey = formatter.format(tomorrow);

  if (targetKey === todayKey) return "Today";
  if (targetKey === tomorrowKey) return "Tomorrow";
  return formatDate(target, timezone);
}

export function greetingFor(date: Date, timezone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );

  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
