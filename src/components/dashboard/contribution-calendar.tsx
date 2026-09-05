"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  LEVEL_LABEL,
  STATUS_LABEL,
  type CalendarDay,
  type ContributionLevel,
} from "@/lib/activity/types";

export interface ContributionCalendarProps {
  /** Inclusive "YYYY-MM-DD" bounds. */
  startDate: string;
  endDate: string;
  activities: CalendarDay[];
  /** Future day keys expected to run; merged with `activities`. */
  plannedActivities?: string[];
  onSelectDay?: (day: CalendarDay) => void;
  className?: string;
}

const LEVEL_CLASS: Record<ContributionLevel, string> = {
  empty: "bg-contribution-empty",
  low: "bg-contribution-low",
  medium: "bg-contribution-medium",
  high: "bg-contribution-high",
  "very-high": "bg-contribution-very-high",
};

const WEEKDAY_ROW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function parseDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

function toDayKey(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function formatLongDate(dayKey: string): string {
  const date = parseDayKey(dayKey);
  const month = MONTH_NAMES[date.getUTCMonth()] ?? "";
  return month + " " + date.getUTCDate() + ", " + date.getUTCFullYear();
}

function describeDay(day: CalendarDay): string {
  const date = formatLongDate(day.date);
  if (day.status === "planned") return date + ": planned activity";
  if (day.count === 0 && day.status === "none") return date + ": " + LEVEL_LABEL.empty;

  const activities = day.count + (day.count === 1 ? " activity" : " activities");
  return date + ": " + activities + ", status " + STATUS_LABEL[day.status];
}

interface Week {
  /** Seven entries; null pads the partial first and last weeks. */
  days: (CalendarDay | null)[];
  monthLabel: string | null;
}

/** Groups days into Sunday-first columns and computes month header labels. */
function buildWeeks(
  startDate: string,
  endDate: string,
  byDate: Map<string, CalendarDay>,
): Week[] {
  const start = parseDayKey(startDate);
  const end = parseDayKey(endDate);

  // Snap back to the Sunday on or before the start date.
  const gridStart = new Date(start);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());

  const weeks: Week[] = [];
  let lastMonth = -1;

  for (
    const cursor = new Date(gridStart);
    cursor.getTime() <= end.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  ) {
    const days: (CalendarDay | null)[] = [];
    let monthLabel: string | null = null;

    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(cursor);
      date.setUTCDate(date.getUTCDate() + offset);

      if (date.getTime() < start.getTime() || date.getTime() > end.getTime()) {
        days.push(null);
        continue;
      }

      const key = toDayKey(date);
      days.push(
        byDate.get(key) ?? {
          date: key,
          count: 0,
          level: "empty",
          status: "none",
          planned: false,
        },
      );
    }

    const firstReal = days.find((day): day is CalendarDay => day !== null);
    if (firstReal) {
      const month = parseDayKey(firstReal.date).getUTCMonth();
      if (month !== lastMonth) {
        monthLabel = MONTH_NAMES[month] ?? null;
        lastMonth = month;
      }
    }

    weeks.push({ days, monthLabel });
  }

  return weeks;
}

/**
 * GitHub-style contribution grid.
 *
 * Colour alone never carries meaning: every cell exposes a text label to
 * assistive technology, failed days use a distinct token, and planned days are
 * drawn with a dashed outline.
 */
export function ContributionCalendar({
  startDate,
  endDate,
  activities,
  plannedActivities = [],
  onSelectDay,
  className,
}: ContributionCalendarProps) {
  const [hovered, setHovered] = React.useState<CalendarDay | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const byDate = React.useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const day of activities) map.set(day.date, day);

    for (const key of plannedActivities) {
      const existing = map.get(key);
      map.set(
        key,
        existing
          ? {
              ...existing,
              planned: true,
              status: existing.count > 0 ? existing.status : "planned",
            }
          : { date: key, count: 0, level: "empty", status: "planned", planned: true },
      );
    }

    return map;
  }, [activities, plannedActivities]);

  const weeks = React.useMemo(
    () => buildWeeks(startDate, endDate, byDate),
    [startDate, endDate, byDate],
  );

  // The most recent weeks matter most, so open scrolled to the right edge.
  React.useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [weeks.length]);

  return (
    <div className={cn("relative", className)}>
      <div
        ref={scrollRef}
        className="overflow-x-auto pb-2 scrollbar-subtle"
        role="group"
        aria-label="Activity calendar for the last 12 months"
      >
        <div className="flex min-w-max gap-2">
          <div
            className="flex flex-col gap-[3px] pt-[18px] pr-1 text-[10px] text-muted-foreground"
            aria-hidden="true"
          >
            {WEEKDAY_ROW_LABELS.map((label, index) => (
              <div key={label} className="flex h-[11px] items-center sm:h-[13px]">
                {index % 2 === 1 ? label : ""}
              </div>
            ))}
          </div>

          <div className="flex gap-[3px]">
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-[3px]">
                <div
                  className="h-[14px] text-[10px] leading-none text-muted-foreground"
                  aria-hidden="true"
                >
                  {week.monthLabel}
                </div>
                {week.days.map((day, dayIndex) =>
                  day === null ? (
                    <div
                      key={"pad-" + dayIndex}
                      className="size-[11px] sm:size-[13px]"
                      aria-hidden="true"
                    />
                  ) : (
                    <CalendarCell
                      key={day.date}
                      day={day}
                      onSelect={onSelectDay}
                      onHoverChange={setHovered}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {hovered ? describeDay(hovered) : "Hover or focus a day for details."}
        </p>
        <CalendarLegend />
      </div>
    </div>
  );
}

interface CalendarCellProps {
  day: CalendarDay;
  onSelect?: (day: CalendarDay) => void;
  onHoverChange: (day: CalendarDay | null) => void;
}

function CalendarCell({ day, onSelect, onHoverChange }: CalendarCellProps) {
  const isPlanned = day.status === "planned";
  const isFailed = day.status === "failed";

  return (
    <button
      type="button"
      title={describeDay(day)}
      aria-label={describeDay(day)}
      onClick={() => onSelect?.(day)}
      onMouseEnter={() => onHoverChange(day)}
      onMouseLeave={() => onHoverChange(null)}
      onFocus={() => onHoverChange(day)}
      onBlur={() => onHoverChange(null)}
      className={cn(
        "size-[11px] rounded-[2px] outline outline-1 outline-transparent sm:size-[13px]",
        "hover:outline-[color:var(--contribution-outline)]",
        "focus-visible:outline-2 focus-visible:outline-ring",
        LEVEL_CLASS[day.level],
        isPlanned && "border border-dashed border-muted-foreground/50 bg-contribution-planned",
        isFailed && "bg-contribution-failed",
      )}
    />
  );
}

function CalendarLegend() {
  const levels = Object.keys(LEVEL_CLASS) as ContributionLevel[];

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>Less</span>
      {levels.map((level) => (
        <span
          key={level}
          role="img"
          title={LEVEL_LABEL[level]}
          aria-label={LEVEL_LABEL[level]}
          className={cn("size-[11px] rounded-[2px]", LEVEL_CLASS[level])}
        />
      ))}
      <span>More</span>
    </div>
  );
}
