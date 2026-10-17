import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Plus, Trash2 } from "lucide-react";

import { createMonitorAction, deleteMonitorAction, toggleMonitorAction } from "@/app/actions/hub";
import { ActionForm } from "@/components/hub/action-form";
import { Header } from "@/components/layout/header";
import { ConfirmAction } from "@/components/settings/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { listMonitors } from "@/services/uptime-service";

export const metadata: Metadata = { title: "Uptime monitors" };
export const dynamic = "force-dynamic";

const STATE_BADGE = {
  UP: { label: "Up", variant: "success" },
  DOWN: { label: "Down", variant: "destructive" },
  UNKNOWN: { label: "Pending first check", variant: "outline" },
} as const;

export default async function UptimePage() {
  const user = await requireUser("notification:manage:own");
  const [preferences, monitors] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.userId }, select: { defaultTimezone: true } }),
    listMonitors(user.userId),
  ]);
  const timezone = preferences?.defaultTimezone ?? "UTC";

  return (
    <>
      <Header
        title="Uptime monitors"
        description="We check every 15 minutes. You hear about it when a site goes down, when it comes back, and before its certificate expires."
        back={{ href: "/notifications", label: "Notification hub" }}
      />

      <div className="flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-4 text-primary" aria-hidden="true" />
              Watch a URL
            </CardTitle>
            <CardDescription>
              Alerts go wherever your <Link href="/notifications?tab=rules" className="underline">uptime rules</Link> send them.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ActionForm action={createMonitorAction} submitLabel="Add monitor" pendingLabel="Adding…" resetOnSuccess className="sm:flex-row sm:items-end">
              <Input name="label" placeholder="Name, e.g. Marketing site" maxLength={60} required aria-label="Name" />
              <Input name="url" type="url" placeholder="https://example.com" maxLength={500} required aria-label="URL" />
            </ActionForm>
          </CardContent>
        </Card>

        {monitors.length === 0 ? (
          <EmptyState icon={Activity} title="No monitors yet" description="Add a public URL above to start watching it." />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <ul className="divide-y divide-border">
                {monitors.map((monitor) => {
                  const badge = STATE_BADGE[monitor.state];
                  return (
                    <li key={monitor.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{monitor.label}</p>
                          {monitor.enabled ? <Badge variant={badge.variant}>{badge.label}</Badge> : <Badge variant="warning">Paused</Badge>}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{monitor.url}</p>
                        <p className="text-xs text-muted-foreground">
                          {monitor.lastCheckedAt
                            ? `Checked ${formatDateTime(monitor.lastCheckedAt, timezone)} · ${
                                monitor.lastError ?? `HTTP ${monitor.lastStatusCode ?? "?"} in ${monitor.lastLatencyMs ?? "?"} ms`
                              }`
                            : "Not checked yet"}
                          {monitor.tlsExpiresAt ? ` · TLS until ${formatDate(monitor.tlsExpiresAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <ActionForm
                          action={toggleMonitorAction}
                          fields={{ id: monitor.id, enabled: String(!monitor.enabled) }}
                          submitLabel={monitor.enabled ? "Pause" : "Resume"}
                          variant="outline"
                        />
                        <ConfirmAction
                          action={deleteMonitorAction}
                          fields={{ id: monitor.id }}
                          triggerLabel="Delete"
                          triggerIcon={<Trash2 aria-hidden="true" />}
                          title={`Stop monitoring ${monitor.label}?`}
                          description="Checks stop right away. Past alerts stay in Activity."
                          confirmLabel="Delete monitor"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
