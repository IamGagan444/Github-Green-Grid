"use client";

import { Pause, Pencil, Play, Trash2 } from "lucide-react";

import { deleteScheduleAction, setScheduleEnabledAction } from "@/app/actions/schedules";
import { RunNowButton } from "@/components/dashboard/run-now-button";
import { ActionButton, ConfirmAction } from "@/components/settings/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { describeRelativeDay, formatDateTime } from "@/lib/format";
import { timezoneLabel } from "@/lib/schedule/timezone";
import {
  describeCommitWindow,
  describeFrequency,
  formatHour,
  getSlotHours,
} from "@/lib/schedule/next-run";
import type { ScheduleWithRepository } from "@/lib/services/schedules";
import { useAppDispatch } from "@/store/hooks";
import { editSchedule } from "@/store/slices/schedule-editor-slice";

export function ScheduleCard({ schedule }: { schedule: ScheduleWithRepository }) {
  const dispatch = useAppDispatch();

  const slotHours = getSlotHours(schedule.commitsPerDay);
  const nextRunLabel =
    schedule.nextRunAt && schedule.nextSlotIndex !== null
      ? describeRelativeDay(schedule.nextRunAt, schedule.timezone) +
        " at " +
        formatHour(slotHours[schedule.nextSlotIndex] ?? slotHours[0] ?? 0)
      : "Paused";

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Automation</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {schedule.repository.fullName}
            </p>
          </div>
          <Badge variant={schedule.enabled ? "success" : "outline"}>
            {schedule.enabled ? "On" : "Paused"}
          </Badge>
        </div>

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Frequency" value={describeFrequency(schedule.daysOfWeek)} />
          <Detail label="Commits per day" value={String(schedule.commitsPerDay)} />
          <Detail label="Timezone" value={timezoneLabel(schedule.timezone)} />
          <Detail label="Next run" value={nextRunLabel} />
        </dl>

        <div className="grid gap-4 sm:grid-cols-2">
          <Detail label="Commit message" value={schedule.commitMessage} />
          <Detail
            label="Last run"
            value={schedule.lastRunAt ? formatDateTime(schedule.lastRunAt, schedule.timezone) : "Never"}
          />
          <Detail label="Commit window" value={describeCommitWindow(schedule.commitsPerDay)} />
        </div>
      </CardContent>

      <CardFooter className="flex-wrap justify-between">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => dispatch(editSchedule(schedule.id))}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <ActionButton
            action={setScheduleEnabledAction}
            fields={{ id: schedule.id, enabled: String(!schedule.enabled) }}
            pendingLabel="Saving…"
          >
            {schedule.enabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {schedule.enabled ? "Pause" : "Resume"}
          </ActionButton>
          <RunNowButton
            scheduleId={schedule.id}
            repositoryFullName={schedule.repository.fullName}
            size="sm"
            variant="outline"
          />
        </div>

        <ConfirmAction
          action={deleteScheduleAction}
          fields={{ id: schedule.id }}
          triggerLabel="Delete"
          triggerIcon={<Trash2 aria-hidden="true" />}
          variant="ghost"
          title="Delete this schedule?"
          description={`GreenGrid will stop performing maintenance on ${schedule.repository.fullName}. Past activity history is kept.`}
          confirmLabel="Delete schedule"
          pendingLabel="Deleting…"
        />
      </CardFooter>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm">{value}</dd>
    </div>
  );
}
