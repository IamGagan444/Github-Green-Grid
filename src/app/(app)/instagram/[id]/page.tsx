import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InstagramAutomationActions } from "@/components/instagram/instagram-automation-actions";
import { Header } from "@/components/layout/header";
import { AutomationStatusBadge, RunStatusBadge, StepStatusBadge } from "@/components/status/status-badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { AuthorizationError } from "@/lib/rbac";
import { getInstagramAutomation, listInstagramEvents } from "@/services/instagram-automation-service";

export const metadata: Metadata = { title: "Instagram automation" };
export const dynamic = "force-dynamic";

const EVENT_LABELS = {
  COMMENT: "Comment",
  MESSAGE: "DM",
  STORY_REPLY: "Story reply",
  STORY_MENTION: "Story mention",
  POSTBACK: "Button tap",
} as const;

export default async function InstagramAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("automation:read:own");
  const { id } = await params;

  const automation = await getInstagramAutomation(user, id).catch((error: unknown) => {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  });
  const events = await listInstagramEvents(user, id);
  const accountDown = automation.integration.status !== "CONNECTED";

  return (
    <>
      <Header
        title={automation.name}
        back={{ href: "/instagram", label: "Instagram automations" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <AutomationStatusBadge status={automation.status} />@{automation.integration.username}
          </span>
        }
        actions={<InstagramAutomationActions id={automation.id} name={automation.name} status={automation.status} />}
      />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
        {accountDown ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            @{automation.integration.username} is disconnected, so nothing is being sent.{" "}
            <a className="font-medium underline" href="/api/integrations/instagram/connect?returnTo=/instagram">
              Reconnect Instagram
            </a>
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Triggered" value={automation.triggeredCount} />
          <StatCard label="DMs sent" value={automation.sentCount} />
          <StatCard label="Link clicks" value={automation.clickCount} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>The last 50 comments, messages and button taps this automation handled.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {events.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing yet. Activity shows up here as it happens.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Steps</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(event.createdAt)}</TableCell>
                      <TableCell className="text-xs">{event.senderUsername ? `@${event.senderUsername}` : "—"}</TableCell>
                      <TableCell className="max-w-64 text-xs">
                        <span className="font-medium">{EVENT_LABELS[event.type]}</span>
                        {event.type !== "POSTBACK" && event.text ? (
                          <span className="block truncate text-muted-foreground">{event.text}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <RunStatusBadge status={event.status} />
                        {event.errorMessage && event.status !== "SUCCESS" ? (
                          <span className="mt-1 block max-w-56 text-xs text-muted-foreground">{event.errorMessage}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StepStatusBadge status={event.dmStatus} label="DM" />
                          {event.type === "COMMENT" ? (
                            <StepStatusBadge status={event.publicReplyStatus} label="Reply" />
                          ) : null}
                          <StepStatusBadge status={event.linkStatus} label="Link" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
