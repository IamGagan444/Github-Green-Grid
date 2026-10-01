"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { ScheduleCard } from "@/components/schedule/schedule-card";
import {
  ScheduleForm,
  type ScheduleFormRepository,
} from "@/components/schedule/schedule-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { ScheduleWithRepository } from "@/lib/services/schedules";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { createSchedule, showScheduleList } from "@/store/slices/schedule-editor-slice";

interface ScheduleManagerProps {
  schedules: ScheduleWithRepository[];
  repositories: ScheduleFormRepository[];
  timezones: string[];
  defaults: { timezone: string; commitMessage: string; repositoryId: string | null };
}

/** Switches between the schedule summary and the create/edit form (mode lives in Redux). */
export function ScheduleManager({
  schedules,
  repositories,
  timezones,
  defaults,
}: ScheduleManagerProps) {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.scheduleEditor.mode);
  const editingId = useAppSelector((state) => state.scheduleEditor.scheduleId);

  // Every visit to the page starts on the list.
  React.useEffect(() => {
    dispatch(showScheduleList());
  }, [dispatch]);

  const hasWritableRepository = repositories.some(
    (repository) => repository.canPush && !repository.archived,
  );
  const editing = mode === "edit" ? (schedules.find((schedule) => schedule.id === editingId) ?? null) : null;

  if (mode === "create" || editing) {
    return (
      <ScheduleForm
        repositories={repositories}
        timezones={timezones}
        schedule={editing}
        defaults={defaults}
        onDone={() => dispatch(showScheduleList())}
      />
    );
  }

  if (schedules.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No schedule configured."
        description={
          hasWritableRepository
            ? "Pick the days and time GreenGrid should perform repository maintenance."
            : "Select a repository you have write access to before creating a schedule."
        }
        action={
          hasWritableRepository ? (
            <Button onClick={() => dispatch(createSchedule())}>Create schedule</Button>
          ) : (
            <Button asChild>
              <Link href="/dashboard/repositories">Choose a repository</Link>
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {schedules.map((schedule) => (
        <ScheduleCard key={schedule.id} schedule={schedule} />
      ))}

      <div>
        <Button
          variant="outline"
          onClick={() => dispatch(createSchedule())}
          disabled={!hasWritableRepository}
        >
          Add another schedule
        </Button>
      </div>
    </div>
  );
}
