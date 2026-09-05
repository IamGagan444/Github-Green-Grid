"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";

import { DaySelector } from "@/components/schedule/day-selector";
import { TimezoneSelector } from "@/components/schedule/timezone-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiFetch, messageFor } from "@/lib/client/api-client";
import { describeRelativeDay } from "@/lib/format";
import {
  describeCommitWindow,
  formatHour,
  getNextOccurrence,
  getSlotHours,
  MAX_COMMITS_PER_DAY,
  MIN_COMMITS_PER_DAY,
} from "@/lib/schedule/next-run";
import type { Weekday } from "@/lib/schedule/timezone";
import {
  activityPathSchema,
  commitMessageSchema,
  daysOfWeekSchema,
  timezoneSchema,
} from "@/lib/validation/schemas";
import type { ScheduleWithRepository } from "@/lib/services/schedules";

const formSchema = z.object({
  repositoryId: z.string().min(1, "Select a repository."),
  enabled: z.boolean(),
  timezone: timezoneSchema,
  // The API schema coerces from strings; the form already holds a number, and
  // a non-coercing field keeps react-hook-form's inferred types exact.
  commitsPerDay: z
    .number()
    .int()
    .min(MIN_COMMITS_PER_DAY)
    .max(MAX_COMMITS_PER_DAY),
  daysOfWeek: daysOfWeekSchema,
  commitMessage: commitMessageSchema,
  activityPath: activityPathSchema,
});

type FormValues = z.infer<typeof formSchema>;

export interface ScheduleFormRepository {
  id: string;
  fullName: string;
  archived: boolean;
  canPush: boolean;
}

interface ScheduleFormProps {
  repositories: ScheduleFormRepository[];
  timezones: string[];
  schedule: ScheduleWithRepository | null;
  defaults: { timezone: string; commitMessage: string; repositoryId: string | null };
  onDone?: () => void;
}

export function ScheduleForm({
  repositories,
  timezones,
  schedule,
  defaults,
  onDone,
}: ScheduleFormProps) {
  const router = useRouter();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      repositoryId: schedule?.repository.id ?? defaults.repositoryId ?? "",
      enabled: schedule?.enabled ?? true,
      timezone: schedule?.timezone ?? defaults.timezone,
      commitsPerDay: schedule?.commitsPerDay ?? 1,
      daysOfWeek: (schedule?.daysOfWeek ?? [
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
      ]) as Weekday[],
      commitMessage: schedule?.commitMessage ?? defaults.commitMessage,
      activityPath: schedule?.activityPath ?? ".greengrid/activity.json",
    },
  });

  // `useWatch` (rather than `form.watch()`) keeps the subscription memoizable,
  // so the next-run preview recomputes only when the inputs actually change.
  const values = useWatch({ control: form.control });

  const nextRun = React.useMemo(() => {
    const parsed = formSchema.safeParse(values);
    if (!parsed.success) return null;
    return getNextOccurrence({
      timezone: parsed.data.timezone,
      commitsPerDay: parsed.data.commitsPerDay,
      daysOfWeek: parsed.data.daysOfWeek,
    });
  }, [values]);

  async function onSubmit(input: FormValues) {
    try {
      if (schedule) {
        await apiFetch("/api/schedules/" + schedule.id, {
          method: "PATCH",
          body: JSON.stringify(input),
        });
        toast.success("Schedule updated.");
      } else {
        await apiFetch("/api/schedules", { method: "POST", body: JSON.stringify(input) });
        toast.success("Schedule created.");
      }

      router.refresh();
      onDone?.();
    } catch (error) {
      toast.error(messageFor(error));
    }
  }

  const selectableRepositories = repositories.filter(
    (repository) => repository.canPush && !repository.archived,
  );

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{schedule ? "Edit schedule" : "Create schedule"}</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-6 pt-0">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="enabled">Automation</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                When on, GreenGrid runs this schedule automatically.
              </p>
            </div>
            <Controller
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <Switch id="enabled" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          <Field
            label="Repository"
            htmlFor="repositoryId"
            error={form.formState.errors.repositoryId?.message}
          >
            <Controller
              control={form.control}
              name="repositoryId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="repositoryId">
                    <SelectValue placeholder="Choose a repository" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableRepositories.map((repository) => (
                      <SelectItem key={repository.id} value={repository.id}>
                        {repository.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {selectableRepositories.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No writable repositories yet. Choose one on the Repositories page first.
              </p>
            ) : null}
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              label="Timezone"
              htmlFor="timezone"
              error={form.formState.errors.timezone?.message}
            >
              <Controller
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <TimezoneSelector
                    id="timezone"
                    value={field.value}
                    timezones={timezones}
                    onChange={field.onChange}
                  />
                )}
              />
            </Field>

            <Field
              label="Commits per day"
              htmlFor="commitsPerDay"
              error={form.formState.errors.commitsPerDay?.message}
              hint={"Between " + MIN_COMMITS_PER_DAY + " and " + MAX_COMMITS_PER_DAY + ". GreenGrid picks the times."}
            >
              <Controller
                control={form.control}
                name="commitsPerDay"
                render={({ field }) => (
                  <CommitsPerDayControl value={field.value} onChange={field.onChange} />
                )}
              />
            </Field>
          </div>

          <Field
            label="Days"
            errorId="daysOfWeek-error"
            error={form.formState.errors.daysOfWeek?.message}
          >
            <Controller
              control={form.control}
              name="daysOfWeek"
              render={({ field }) => (
                <DaySelector
                  value={field.value}
                  onChange={field.onChange}
                  describedBy={
                    form.formState.errors.daysOfWeek ? "daysOfWeek-error" : undefined
                  }
                />
              )}
            />
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              label="Commit message"
              htmlFor="commitMessage"
              error={form.formState.errors.commitMessage?.message}
            >
              <Input id="commitMessage" {...form.register("commitMessage")} />
            </Field>

            <Field
              label="Activity file"
              htmlFor="activityPath"
              error={form.formState.errors.activityPath?.message}
              hint="Repository-relative JSON path GreenGrid maintains."
            >
              <Input id="activityPath" {...form.register("activityPath")} />
            </Field>
          </div>

          <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
            <p className="text-xs font-medium text-muted-foreground">Next scheduled activity</p>
            <p className="mt-1">
              {nextRun && values.timezone
                ? describeRelativeDay(nextRun.runAt, values.timezone) +
                  " at " +
                  formatHour(getSlotHours(values.commitsPerDay ?? 1)[nextRun.slotIndex] ?? 0) +
                  " (" +
                  values.timezone +
                  ")"
                : "Select at least one day."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {describeCommitWindow(values.commitsPerDay ?? 1)}
            </p>
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? "Saving…"
              : schedule
                ? "Save changes"
                : "Create schedule"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  errorId?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, error, errorId, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface CommitsPerDayControlProps {
  value: number;
  onChange: (value: number) => void;
}

/**
 * Slider plus numeric readout. The user chooses how many commits, never when —
 * the clock times are derived server-side from this number.
 */
function CommitsPerDayControl({ value, onChange }: CommitsPerDayControlProps) {
  return (
    <div className="flex items-center gap-3">
      <Input
        id="commitsPerDay"
        type="range"
        min={MIN_COMMITS_PER_DAY}
        max={MAX_COMMITS_PER_DAY}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-9 cursor-pointer accent-[color:var(--primary)]"
        aria-describedby="commitsPerDay-readout"
      />
      <output
        id="commitsPerDay-readout"
        className="w-14 shrink-0 rounded-md border border-border px-2 py-1.5 text-center text-sm tabular-nums"
      >
        {value}
      </output>
    </div>
  );
}
