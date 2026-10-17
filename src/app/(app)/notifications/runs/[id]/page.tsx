import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RotateCcw } from "lucide-react";

import { retryRunAction } from "@/app/actions/hub";
import { ActionForm } from "@/components/hub/action-form";
import { Header } from "@/components/layout/header";
import { RunStatusBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { idParamSchema } from "@/validators/automation";
import { getRunForUser } from "@/services/notification-service";

export const metadata: Metadata = { title: "Delivery" };
export const dynamic = "force-dynamic";

const STEP_BADGE = {
  PENDING: { label: "Pending", variant: "outline" },
  IN_FLIGHT: { label: "Sending", variant: "warning" },
  SUCCESS: { label: "Delivered", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
  SKIPPED: { label: "Skipped", variant: "outline" },
  UNKNOWN: { label: "Unconfirmed", variant: "warning" },
} as const;

const KIND_LABEL = {
  NOTIFY: "Notification",
  FORM_SUBMISSION: "Form submission",
  REMINDER: "Payment reminder",
  DIGEST: "Morning digest",
  CROSSPOST_DRAFT: "Cross-post draft",
  CROSSPOST_PUBLISH: "Cross-post",
} as const;

function stepLabel(key: string, channels: Map<string, string>): string {
  if (key.startsWith("notify:")) return `Notify ${channels.get(key.slice(7)) ?? "a removed channel"}`;
  return key;
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("notification:manage:own");
  const parsed = idParamSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  const [run, preferences, channels] = await Promise.all([
    getRunForUser(user.userId, parsed.data),
    prisma.user.findUnique({ where: { id: user.userId }, select: { defaultTimezone: true } }),
    prisma.notificationChannel.findMany({ where: { userId: user.userId }, select: { id: true, label: true } }),
  ]);
  if (!run) notFound();
  const timezone = preferences?.defaultTimezone ?? "UTC";
  const channelNames = new Map(channels.map((channel) => [channel.id, channel.label]));

  return (
    <>
      <Header title={run.title} description={KIND_LABEL[run.kind]} back={{ href: "/notifications?tab=activity", label: "Activity" }} />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              Status <RunStatusBadge status={run.status} />
            </CardTitle>
            {run.status === "FAILED" ? (
              <ActionForm action={retryRunAction} fields={{ id: run.id }} submitLabel="Retry failed steps" variant="outline" icon={<RotateCcw aria-hidden="true" />} />
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-2 pt-0 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Created:</span> {formatDateTime(run.createdAt, timezone)}
            </p>
            {run.finishedAt ? (
              <p>
                <span className="text-muted-foreground">Finished:</span> {formatDateTime(run.finishedAt, timezone)}
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">Attempts:</span> {run.attempt}
            </p>
            {run.status === "RUNNING" && run.nextRetryAt ? (
              <p>
                <span className="text-muted-foreground">Next retry:</span> {formatDateTime(run.nextRetryAt, timezone)}
              </p>
            ) : null}
            {run.errorMessage ? <p className="text-destructive sm:col-span-2">{run.errorMessage}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ol className="divide-y divide-border">
              {run.steps.map((step) => {
                const badge = STEP_BADGE[step.status];
                return (
                  <li key={step.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{stepLabel(step.key, channelNames)}</p>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {step.attempt} attempt{step.attempt === 1 ? "" : "s"}
                      {step.semantics === "AT_MOST_ONCE" ? " · never sent twice" : ""}
                      {step.completedAt ? ` · ${formatDateTime(step.completedAt, timezone)}` : ""}
                    </p>
                    {step.errorMessage ? <p className="text-xs text-destructive">{step.errorMessage}</p> : null}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
