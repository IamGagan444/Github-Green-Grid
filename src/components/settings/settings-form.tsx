"use client";

import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { saveSettingsAction } from "@/app/actions/account";
import { MESSAGE_STYLE_OPTIONS } from "@/components/automations/options";
import { DaySelector } from "@/components/schedule/day-selector";
import { TimezoneSelector } from "@/components/schedule/timezone-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IDLE_ACTION_STATE } from "@/lib/actions/action-state";
import { useActionToast } from "@/lib/client/use-action-toast";
import { settingsSchema } from "@/lib/validation/schemas";

type FormValues = z.infer<typeof settingsSchema>;

interface SettingsFormProps {
  defaultValues: FormValues;
  timezones: string[];
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

export function SettingsForm({ defaultValues, timezones }: SettingsFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues,
  });
  const errors = form.formState.errors;
  const values = useWatch({ control: form.control });

  const formRef = React.useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = React.useActionState(saveSettingsAction, IDLE_ACTION_STATE);
  useActionToast(state);

  // After hydration, validate on the client first; before hydration the native
  // form posts straight to the Server Action, which validates on its own.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.handleSubmit(() => {
      if (!formRef.current) return;
      const data = new FormData(formRef.current);
      React.startTransition(() => formAction(data));
    })(event);
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate>
      {/* Values of the custom (non-native) controls, so the form posts them. */}
      <input type="hidden" name="defaultTimezone" value={values.defaultTimezone ?? ""} />
      <input type="hidden" name="defaultMessageStyle" value={values.defaultMessageStyle ?? ""} />
      {(values.defaultDaysOfWeek ?? []).map((day) => (
        <input key={day} type="hidden" name="defaultDaysOfWeek" value={day} />
      ))}
      <Card id="defaults">
        <CardHeader>
          <CardTitle>Automation defaults</CardTitle>
          <CardDescription>Pre-filled when you create a new standup automation or commit schedule.</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5 pt-0">
          <div className="flex flex-col gap-2">
            <Label htmlFor="defaultTimezone">Timezone</Label>
            <Controller
              control={form.control}
              name="defaultTimezone"
              render={({ field }) => (
                <TimezoneSelector id="defaultTimezone" value={field.value} timezones={timezones} onChange={field.onChange} />
              )}
            />
            <FieldError message={errors.defaultTimezone?.message} />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="defaultScheduleTime">Standup time</Label>
              <Input id="defaultScheduleTime" type="time" step={60} {...form.register("defaultScheduleTime")} />
              <FieldError message={errors.defaultScheduleTime?.message} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="defaultMessageStyle">Message style</Label>
              <Controller
                control={form.control}
                name="defaultMessageStyle"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="defaultMessageStyle">
                      <SelectValue placeholder="Choose a style" />
                    </SelectTrigger>
                    <SelectContent>
                      {MESSAGE_STYLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Standup days</Label>
            <Controller
              control={form.control}
              name="defaultDaysOfWeek"
              render={({ field }) => <DaySelector value={field.value ?? []} onChange={field.onChange} />}
            />
            <FieldError message={errors.defaultDaysOfWeek?.message} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="defaultCommitMessage">Commit-activity message</Label>
            <Input id="defaultCommitMessage" {...form.register("defaultCommitMessage")} />
            {errors.defaultCommitMessage ? (
              <FieldError message={errors.defaultCommitMessage.message} />
            ) : (
              <p className="text-xs text-muted-foreground">
                Used when a new commit schedule is created. Existing schedules keep their own message.
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save defaults"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
