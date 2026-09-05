"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch, messageFor } from "@/lib/client/api-client";
import { formatDateTime } from "@/lib/format";

interface RunResult {
  status: "COMPLETED" | "SKIPPED";
  commitSha?: string;
  commitUrl?: string;
  repositoryFullName?: string;
  executedAt?: string;
  reason?: string;
}

interface RunNowButtonProps {
  scheduleId: string;
  repositoryFullName: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}

/** Confirms, then performs exactly one activity update outside the schedule. */
export function RunNowButton({
  scheduleId,
  repositoryFullName,
  size,
  variant,
}: RunNowButtonProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = React.useState(false);
  const [result, setResult] = React.useState<RunResult | null>(null);

  async function run() {
    setIsRunning(true);
    try {
      const data = await apiFetch<{ result: RunResult }>("/api/activity/run", {
        method: "POST",
        body: JSON.stringify({ scheduleId }),
      });

      if (data.result.status === "SKIPPED") {
        toast.info(data.result.reason ?? "Nothing to do right now.");
      } else {
        setResult(data.result);
        toast.success("Activity completed successfully.");
      }

      router.refresh();
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size={size} variant={variant} disabled={isRunning}>
            <Zap aria-hidden="true" />
            {isRunning ? "Running…" : "Run activity now"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run activity now?</AlertDialogTitle>
            <AlertDialogDescription>
              GreenGrid will update the activity file in {repositoryFullName} and create one
              commit through GitHub&apos;s API, attributed to your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Run now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={result !== null} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activity completed successfully.</DialogTitle>
            <DialogDescription>
              One commit was created through GitHub&apos;s official API.
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Repository</dt>
                <dd className="mt-0.5">{result.repositoryFullName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Commit SHA</dt>
                <dd className="mt-0.5 font-mono text-xs break-all">{result.commitSha}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Timestamp</dt>
                <dd className="mt-0.5">
                  {result.executedAt ? formatDateTime(result.executedAt) : "—"}
                </dd>
              </div>
            </dl>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setResult(null)}>
              Close
            </Button>
            {result?.commitUrl ? (
              <Button asChild>
                <a href={result.commitUrl} target="_blank" rel="noreferrer noopener">
                  View commit
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
