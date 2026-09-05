"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";

import { TimezoneSelector } from "@/components/schedule/timezone-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, messageFor } from "@/lib/client/api-client";
import { settingsSchema } from "@/lib/validation/schemas";

type FormValues = z.infer<typeof settingsSchema>;

interface SettingsFormProps {
  defaultValues: FormValues;
  timezones: string[];
  selectedRepository: string | null;
}

export function SettingsForm({
  defaultValues,
  timezones,
  selectedRepository,
}: SettingsFormProps) {
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues,
  });

  async function onSubmit(values: FormValues) {
    try {
      await apiFetch("/api/settings", { method: "PATCH", body: JSON.stringify(values) });
      toast.success("Automation defaults saved.");
      router.refresh();
    } catch (error) {
      toast.error(messageFor(error));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Automation defaults</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-5 pt-0">
          <div className="flex flex-col gap-2">
            <Label>Default repository</Label>
            <Input value={selectedRepository ?? "No repository selected"} readOnly disabled />
            <p className="text-xs text-muted-foreground">
              Change this on the Repositories page.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="defaultTimezone">Default timezone</Label>
            <Controller
              control={form.control}
              name="defaultTimezone"
              render={({ field }) => (
                <TimezoneSelector
                  id="defaultTimezone"
                  value={field.value}
                  timezones={timezones}
                  onChange={field.onChange}
                />
              )}
            />
            {form.formState.errors.defaultTimezone ? (
              <p role="alert" className="text-xs text-destructive">
                {form.formState.errors.defaultTimezone.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="defaultCommitMessage">Default commit message</Label>
            <Input id="defaultCommitMessage" {...form.register("defaultCommitMessage")} />
            {form.formState.errors.defaultCommitMessage ? (
              <p role="alert" className="text-xs text-destructive">
                {form.formState.errors.defaultCommitMessage.message}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Used when a new schedule is created. Existing schedules keep their own message.
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save defaults"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
