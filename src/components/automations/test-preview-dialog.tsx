"use client";

import { CheckCircle2, ExternalLink, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PreviewResult } from "@/services/automation-service";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setPreviewOpen } from "@/store/slices/test-preview-slice";

/** Reverses Slack's &amp;/&lt;/&gt; escaping for on-screen preview only. */
function unescapeSlack(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** The app's single test-result dialog, driven by the `testPreview` Redux slice. */
export function TestPreviewHost() {
  const open = useAppSelector((state) => state.testPreview.open);
  const preview = useAppSelector((state) => state.testPreview.preview);
  const dispatch = useAppDispatch();
  return (
    <TestPreviewDialog open={open} onOpenChange={(next) => dispatch(setPreviewOpen(next))} preview={preview} />
  );
}

function TestPreviewDialog({
  open,
  onOpenChange,
  preview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: PreviewResult | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Test result</DialogTitle>
          <DialogDescription>
            Real GitHub data and a real Nemotron summary, posted to Slack as a labelled test. It does not count as
            today&apos;s update.
          </DialogDescription>
        </DialogHeader>

        {preview ? (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success">
                <CheckCircle2 aria-hidden="true" />
                Test posted to {preview.channel.isPrivate ? "🔒" : "#"}
                {preview.channel.name}
              </Badge>
              <Badge variant="outline">Commits from {preview.commitDate}</Badge>
              <Badge variant="outline">{preview.commitCount} commits found</Badge>
              {preview.testMessageUrl ? (
                <a
                  href={preview.testMessageUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                >
                  Open in Slack
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              ) : null}
            </div>

            {preview.note ? (
              <p className="flex items-start gap-2 rounded-md border border-border bg-secondary/40 p-3 text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {preview.note} On a scheduled run this day would be recorded as skipped and nothing would be posted.
              </p>
            ) : null}

            {preview.messageText ? (
              <section aria-labelledby="slack-preview">
                <h3 id="slack-preview" className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Slack preview
                </h3>
                <div className="rounded-lg border border-border bg-card p-4">
                  {preview.parentText ? (
                    <p className="font-medium">{unescapeSlack(preview.parentText)}</p>
                  ) : null}
                  <div className={preview.parentText ? "mt-3 border-l-2 border-border pl-3" : undefined}>
                    <p className="font-semibold">Today&apos;s Update</p>
                    <ul className="mt-2 flex flex-col gap-1">
                      {preview.summary.map((bullet) => (
                        <li key={bullet}>✅ {bullet}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            ) : null}

            {preview.repositories.length > 0 ? (
              <section aria-labelledby="repos-preview">
                <h3 id="repos-preview" className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Repositories
                </h3>
                <ul className="flex flex-col gap-1">
                  {preview.repositories.map((repository) => (
                    <li key={repository.fullName} className="flex justify-between gap-3">
                      <span className="truncate">
                        {repository.fullName} <span className="text-muted-foreground">· {repository.branch ?? "all branches"}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{repository.commitCount}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {preview.commits.length > 0 ? (
              <section aria-labelledby="commits-preview">
                <h3 id="commits-preview" className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Commits used
                </h3>
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {preview.commits.map((commit, index) => (
                    <li key={`${commit.url ?? commit.message}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate">{commit.message}</span>
                      {commit.url ? (
                        <a
                          href={commit.url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label="Open commit on GitHub"
                        >
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
