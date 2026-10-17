import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, FileSpreadsheet, Plus } from "lucide-react";

import { createFormAction } from "@/app/actions/forms";
import { FormEditor } from "@/components/forms/form-editor";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { CHANNEL_KIND_LABELS } from "@/lib/hub/channel-config";
import { listChannels } from "@/services/channel-service";
import { listForms } from "@/services/form-service";
import { getGoogleIntegration } from "@/services/google-service";

export const metadata: Metadata = { title: "Forms" };
export const dynamic = "force-dynamic";

const STARTER_FIELDS = [
  { id: "your_name", label: "Your name", type: "text" as const, required: true },
  { id: "your_email", label: "Your email", type: "email" as const, required: true },
  { id: "message", label: "Message", type: "textarea" as const, required: false },
];

export default async function FormsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("notification:manage:own");
  const [{ tab }, forms, channels, google] = await Promise.all([
    searchParams,
    listForms(user.userId),
    listChannels(user.userId),
    getGoogleIntegration(user.userId),
  ]);
  const creating = tab === "new" || forms.length === 0;
  const working = channels.filter((channel) => channel.verified).map((channel) => ({ id: channel.id, label: channel.label, kindLabel: CHANNEL_KIND_LABELS[channel.kind] }));

  return (
    <>
      <Header
        title="Forms"
        description="Share a form link. Every response lands in your Google Sheet and pings you right away."
        actions={
          creating ? null : (
            <Button asChild size="sm">
              <Link href="/forms?tab=new">
                <Plus aria-hidden="true" />
                New form
              </Link>
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        {creating ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="size-4 text-primary" aria-hidden="true" />
                New form
              </CardTitle>
              <CardDescription>We&apos;ll create a Google Sheet for it in your Drive, with one column per question.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {google.canCreateSheets ? (
                <FormEditor
                  action={createFormAction}
                  submitLabel="Create form"
                  successHref="/forms"
                  channels={working}
                  initial={{
                    name: "",
                    fields: STARTER_FIELDS,
                    thankYouMessage: "Thanks! We received your response.",
                    ackEnabled: false,
                    ackSubject: "",
                    ackBody: "",
                    allowedOrigins: [],
                    channelIds: working.length === 1 ? [working[0]!.id] : [],
                  }}
                />
              ) : (
                <EmptyState
                  icon={FileSpreadsheet}
                  title="Connect Google first"
                  description="Forms save responses to a Google Sheet, so GreenGrid needs permission to create one."
                  className="py-8"
                  action={
                    <Button asChild size="sm">
                      <Link href="/settings/connections">Connect Google</Link>
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>
        ) : null}

        {forms.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-primary" aria-hidden="true" />
                Your forms
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="divide-y divide-border rounded-md border border-border">
                {forms.map((form) => (
                  <li key={form.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/forms/${form.id}`} className="truncate text-sm font-medium hover:underline">
                          {form.name}
                        </Link>
                        {form.status === "ACTIVE" ? <Badge variant="success">Open</Badge> : <Badge variant="warning">Paused</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {form.submissionCount} response{form.submissionCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {form.sheetUrl ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={form.sheetUrl} target="_blank" rel="noreferrer">
                            <ExternalLink aria-hidden="true" />
                            Sheet
                          </a>
                        </Button>
                      ) : null}
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/forms/${form.id}`}>Manage</Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
