import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink, Inbox, Link2, Pencil, Trash2 } from "lucide-react";

import { deleteFormAction, toggleFormAction, updateFormAction } from "@/app/actions/forms";
import { FormEditor } from "@/components/forms/form-editor";
import { ActionForm } from "@/components/hub/action-form";
import { Header } from "@/components/layout/header";
import { ConfirmAction } from "@/components/settings/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { CHANNEL_KIND_LABELS } from "@/lib/hub/channel-config";
import { idParamSchema } from "@/validators/automation";
import { listChannels } from "@/services/channel-service";
import { getOwnedForm } from "@/services/form-service";

export const metadata: Metadata = { title: "Form" };
export const dynamic = "force-dynamic";

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("notification:manage:own");
  const parsed = idParamSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const [form, channels, preferences] = await Promise.all([
    getOwnedForm(user.userId, parsed.data),
    listChannels(user.userId),
    prisma.user.findUnique({ where: { id: user.userId }, select: { defaultTimezone: true } }),
  ]);
  if (!form) notFound();

  const timezone = preferences?.defaultTimezone ?? "UTC";
  const appUrl = getAppUrl();
  const link = `${appUrl}/f/${form.publicId}`;
  const working = channels.filter((channel) => channel.verified).map((channel) => ({ id: channel.id, label: channel.label, kindLabel: CHANNEL_KIND_LABELS[channel.kind] }));
  const active = form.status === "ACTIVE";
  const embed = [
    `<form method="post" action="${appUrl}/api/forms/${form.publicId}">`,
    ...form.fields.map((field) =>
      field.type === "textarea"
        ? `  <textarea name="${field.id}" placeholder="${field.label.replace(/"/g, "&quot;")}"${field.required ? " required" : ""}></textarea>`
        : `  <input name="${field.id}" placeholder="${field.label.replace(/"/g, "&quot;")}"${field.type === "checkbox" ? ' type="checkbox"' : field.type === "email" ? ' type="email"' : ""}${field.required ? " required" : ""}>`,
    ),
    `  <input name="website" style="display:none" tabindex="-1" autocomplete="off">`,
    `  <button type="submit">Send</button>`,
    `</form>`,
  ].join("\n");

  return (
    <>
      <Header
        title={form.name}
        description={`${form.submissionCount} response${form.submissionCount === 1 ? "" : "s"}`}
        back={{ href: "/forms", label: "Forms" }}
        actions={
          <div className="flex flex-wrap gap-2">
            <ActionForm
              action={toggleFormAction}
              fields={{ id: form.id, active: String(!active) }}
              submitLabel={active ? "Pause" : "Reopen"}
              variant="outline"
            />
            <ConfirmAction
              action={deleteFormAction}
              fields={{ id: form.id }}
              triggerLabel="Delete"
              triggerIcon={<Trash2 aria-hidden="true" />}
              title={`Delete “${form.name}”?`}
              description="The link stops working and stored responses are deleted here. Your Google Sheet stays in your Drive."
              confirmLabel="Delete form"
            />
          </div>
        }
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="size-4 text-primary" aria-hidden="true" />
                Share
              </CardTitle>
              <CardDescription>{active ? "Anyone with this link can respond." : "Paused: the link shows the form is closed."}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs">{link}</code>
                <Button asChild size="sm" variant="outline">
                  <a href={link} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden="true" />
                    Open
                  </a>
                </Button>
                {form.sheetUrl ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={form.sheetUrl} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden="true" />
                      Sheet
                    </a>
                  </Button>
                ) : null}
              </div>
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">Use it on your own website</summary>
                <p className="mt-3 text-xs text-muted-foreground">
                  Add your site under &quot;Your website&quot; below, then paste this HTML and style it however you like.
                </p>
                <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 text-xs">{embed}</pre>
              </details>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Inbox className="size-4 text-primary" aria-hidden="true" />
                Latest responses
              </CardTitle>
              <CardDescription>Your last 10 here; the full list is in your Sheet. Kept here for 90 days.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {form.submissions.length === 0 ? (
                <EmptyState icon={Inbox} title="No responses yet" description="Open the link and send a test response." className="py-8" />
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {form.submissions.map((submission) => {
                    const values = (submission.data ?? {}) as Record<string, string>;
                    const preview = form.fields
                      .map((field) => values[field.id])
                      .filter((value) => value && value !== "No")
                      .slice(0, 3)
                      .join(" · ");
                    return (
                      <li key={submission.id} className="flex flex-col gap-0.5 px-3 py-2.5">
                        <p className="truncate text-sm">{preview || "(empty)"}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(submission.createdAt, timezone)}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Pencil className="size-4 text-primary" aria-hidden="true" />
              Edit
              {form.submissionCount > 0 ? <Badge variant="outline">Fields locked</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <FormEditor
              action={updateFormAction}
              hidden={{ id: form.id }}
              submitLabel="Save changes"
              channels={working}
              fieldsLocked={form.submissionCount > 0}
              initial={{
                name: form.name,
                fields: form.fields,
                thankYouMessage: form.thankYouMessage,
                ackEnabled: form.ackEnabled,
                ackSubject: form.ackSubject ?? "",
                ackBody: form.ackBody ?? "",
                allowedOrigins: form.allowedOrigins,
                channelIds: form.channelIds,
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
