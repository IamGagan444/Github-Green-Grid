"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { RunNowButton } from "@/components/dashboard/run-now-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiFetch, messageFor } from "@/lib/client/api-client";
import { describeRelativeDay, formatDateTime } from "@/lib/format";
import {
  describeCommitWindow,
  describeFrequency,
  formatHour,
  getSlotHours,
} from "@/lib/schedule/next-run";
import type { ScheduleWithRepository } from "@/lib/services/schedules";

interface ScheduleCardProps {
  schedule: ScheduleWithRepository;
  onEdit: (schedule: ScheduleWithRepository) => void;
}

export function ScheduleCard({ schedule, onEdit }: ScheduleCardProps) {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);

  async function toggleEnabled() {
    setIsPending(true);
    try {
      await apiFetch("/api/schedules/" + schedule.id, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      toast.success(schedule.enabled ? "Automation paused." : "Automation resumed.");
      router.refresh();
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      setIsPending(false);
    }
  }

  async function remove() {
    setIsPending(true);
    try {
      await apiFetch("/api/schedules/" + schedule.id, { method: "DELETE" });
      toast.success("Schedule deleted.");
      router.refresh();
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      setIsPending(false);
    }
  }

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
          <Detail label="Timezone" value={schedule.timezone} />
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
          <Button variant="outline" size="sm" onClick={() => onEdit(schedule)}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={toggleEnabled} disabled={isPending}>
            {schedule.enabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {schedule.enabled ? "Pause" : "Resume"}
          </Button>
          <RunNowButton
            scheduleId={schedule.id}
            repositoryFullName={schedule.repository.fullName}
            size="sm"
            variant="outline"
          />
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10">
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
              <AlertDialogDescription>
                GreenGrid will stop performing maintenance on {schedule.repository.fullName}.
                Past activity history is kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={remove} disabled={isPending}>
                Delete schedule
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
