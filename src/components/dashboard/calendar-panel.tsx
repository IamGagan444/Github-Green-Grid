"use client";

import * as React from "react";
import { CalendarDays, ExternalLink } from "lucide-react";

import {
  ContributionCalendar,
  formatLongDate,
} from "@/components/dashboard/contribution-calendar";
import { ActivityStatus, type ExecutionStatusValue } from "@/components/activity/activity-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, messageFor } from "@/lib/client/api-client";
import { formatDuration, shortSha } from "@/lib/format";
import type { CalendarDay } from "@/lib/activity/types";

interface DayExecution {
  id: string;
  status: ExecutionStatusValue;
  commitSha: string | null;
  commitUrl: string | null;
  commitMessage: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  repository: { id: string; fullName: string };
}

interface CalendarPanelProps {
  startDate: string;
  endDate: string;
  days: CalendarDay[];
  timezone: string;
}

/** Calendar card plus the day-detail dialog opened by clicking a cell. */
export function CalendarPanel({ startDate, endDate, days, timezone }: CalendarPanelProps) {
  const [selectedDay, setSelectedDay] = React.useState<CalendarDay | null>(null);
  const [rows, setRows] = React.useState<DayExecution[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Loading is driven by the click, not by an effect, so opening the dialog
  // never triggers a cascading render.
  const requestId = React.useRef(0);

  async function openDay(day: CalendarDay) {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;

    setSelectedDay(day);
    setRows(null);
    setError(null);

    try {
      const data = await apiFetch<{ rows: DayExecution[] }>(
        "/api/github/activity?view=day&date=" + encodeURIComponent(day.date),
      );
      if (requestId.current === currentRequest) setRows(data.rows);
    } catch (cause) {
      if (requestId.current === currentRequest) setError(messageFor(cause));
    }
  }

  function closeDay() {
    requestId.current += 1;
    setSelectedDay(null);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Contribution calendar</CardTitle>
          <span className="text-xs text-muted-foreground">{timezone}</span>
        </CardHeader>
        <CardContent className="pt-4">
          <ContributionCalendar
            startDate={startDate}
            endDate={endDate}
            activities={days}
            onSelectDay={(day) => void openDay(day)}
          />
        </CardContent>
      </Card>

      <Dialog open={selectedDay !== null} onOpenChange={(open) => {
          if (!open) closeDay();
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDay ? formatLongDate(selectedDay.date) : "Activity"}
            </DialogTitle>
            <DialogDescription>
              {selectedDay?.status === "planned"
                ? "A scheduled run is planned for this day."
                : "Executions recorded for this day."}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : rows === null ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
              No activity was recorded on this day.
            </div>
          ) : (
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto scrollbar-subtle">
              {rows.map((row) => (
                <li key={row.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium">
                      {row.repository.fullName}
                    </p>
                    <ActivityStatus status={row.status} />
                  </div>

                  {row.status === "FAILED" ? (
                    <p className="mt-2 text-sm text-muted-foreground">{row.errorMessage}</p>
                  ) : row.commitUrl ? (
                    <a
                      href={row.commitUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-2 inline-flex items-center gap-1 rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {row.commitMessage}
                      <span className="font-mono text-xs text-muted-foreground">
                        {shortSha(row.commitSha)}
                      </span>
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : null}

                  <p className="mt-1 text-xs text-muted-foreground">
                    Duration {formatDuration(row.durationMs)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
