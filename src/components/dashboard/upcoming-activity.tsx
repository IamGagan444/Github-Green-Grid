import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { describeRelativeDay } from "@/lib/format";
import {
  describeFrequency,
  formatHour,
  getSlotHours,
  getUpcomingOccurrences,
} from "@/lib/schedule/next-run";
import type { ScheduleWithRepository } from "@/lib/services/schedules";

/** Next few planned runs across all enabled schedules. */
export function UpcomingActivity({ schedules }: { schedules: ScheduleWithRepository[] }) {
  const enabled = schedules.filter((schedule) => schedule.enabled);

  const upcoming = enabled
    .flatMap((schedule) =>
      getUpcomingOccurrences(schedule, 3).map((occurrence) => ({
        key: schedule.id + ":" + occurrence.dayKey + ":" + occurrence.slotIndex,
        runAt: occurrence.runAt,
        slotIndex: occurrence.slotIndex,
        schedule,
      })),
    )
    .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())
    .slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming activity</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No schedule configured."
            description="Create a schedule to have GreenGrid perform repository maintenance for you."
            action={
              <Button asChild size="sm">
                <Link href="/dashboard/schedule">Create schedule</Link>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {upcoming.map((entry) => (
              <li key={entry.key} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.schedule.repository.fullName}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {describeFrequency(entry.schedule.daysOfWeek)} · {entry.schedule.timezone}
                  </p>
                </div>
                <p className="shrink-0 text-right text-sm">
                  {describeRelativeDay(entry.runAt, entry.schedule.timezone)}
                  <span className="block text-xs text-muted-foreground">
                    {formatHour(
                      getSlotHours(entry.schedule.commitsPerDay)[entry.slotIndex] ?? 0,
                    )}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
