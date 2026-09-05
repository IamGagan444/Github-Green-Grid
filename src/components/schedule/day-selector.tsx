"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { DAY_LABELS } from "@/lib/schedule/next-run";
import { WEEKDAYS, type Weekday } from "@/lib/schedule/timezone";
import { cn } from "@/lib/utils";

interface DaySelectorProps {
  value: Weekday[];
  onChange: (days: Weekday[]) => void;
  disabled?: boolean;
  /** Ids of the elements describing this group, e.g. an error message. */
  describedBy?: string;
}

/** Weekday checkboxes, Monday first, each with a real label for a11y. */
export function DaySelector({ value, onChange, disabled, describedBy }: DaySelectorProps) {
  const selected = new Set(value);

  function toggle(day: Weekday, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(day);
    else next.delete(day);
    onChange(WEEKDAYS.filter((weekday) => next.has(weekday)));
  }

  return (
    <div
      role="group"
      aria-label="Days of the week"
      aria-describedby={describedBy}
      className="flex flex-wrap gap-2"
    >
      {WEEKDAYS.map((day) => {
        const isChecked = selected.has(day);
        const inputId = "day-" + day.toLowerCase();

        return (
          <label
            key={day}
            htmlFor={inputId}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              isChecked
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-secondary/60",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <Checkbox
              id={inputId}
              checked={isChecked}
              disabled={disabled}
              onCheckedChange={(checked) => toggle(day, checked === true)}
            />
            {DAY_LABELS[day]}
          </label>
        );
      })}
    </div>
  );
}
