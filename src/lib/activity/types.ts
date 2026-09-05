/** Shared between server data loaders and the client calendar component. */

export type ContributionLevel = "empty" | "low" | "medium" | "high" | "very-high";

export type DayStatus = "none" | "completed" | "failed" | "skipped" | "planned";

export interface CalendarDay {
  /** "YYYY-MM-DD" */
  date: string;
  count: number;
  level: ContributionLevel;
  status: DayStatus;
  /** True when the day is in the future and a schedule is expected to run. */
  planned: boolean;
}

export interface ActivityStats {
  currentStreak: number;
  scheduledThisWeek: number;
  completed: number;
  failed: number;
}

export const LEVEL_LABEL: Record<ContributionLevel, string> = {
  empty: "No activity",
  low: "Low activity",
  medium: "Medium activity",
  high: "High activity",
  "very-high": "Very high activity",
};

export const STATUS_LABEL: Record<DayStatus, string> = {
  none: "No activity",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  planned: "Planned",
};

/** Thresholds are intentionally low: GreenGrid makes one commit per run. */
export function levelForCount(count: number): ContributionLevel {
  if (count <= 0) return "empty";
  if (count === 1) return "low";
  if (count === 2) return "medium";
  if (count <= 4) return "high";
  return "very-high";
}
