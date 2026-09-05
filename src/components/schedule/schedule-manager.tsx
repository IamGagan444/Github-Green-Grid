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

interface ScheduleManagerProps {
  schedules: ScheduleWithRepository[];
  repositories: ScheduleFormRepository[];
  timezones: string[];
  defaults: { timezone: string; commitMessage: string; repositoryId: string | null };
}

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; schedule: ScheduleWithRepository };

/** Switches between the schedule summary and the create/edit form. */
export function ScheduleManager({
  schedules,
  repositories,
  timezones,
  defaults,
}: ScheduleManagerProps) {
  const [mode, setMode] = React.useState<Mode>({ kind: "list" });

  const hasWritableRepository = repositories.some(
    (repository) => repository.canPush && !repository.archived,
  );

  if (mode.kind !== "list") {
    return (
      <ScheduleForm
        repositories={repositories}
        timezones={timezones}
        schedule={mode.kind === "edit" ? mode.schedule : null}
        defaults={defaults}
        onDone={() => setMode({ kind: "list" })}
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
            <Button onClick={() => setMode({ kind: "create" })}>Create schedule</Button>
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
        <ScheduleCard
          key={schedule.id}
          schedule={schedule}
          onEdit={(target) => setMode({ kind: "edit", schedule: target })}
        />
      ))}

      <div>
        <Button
          variant="outline"
          onClick={() => setMode({ kind: "create" })}
          disabled={!hasWritableRepository}
        >
          Add another schedule
        </Button>
      </div>
    </div>
  );
}
