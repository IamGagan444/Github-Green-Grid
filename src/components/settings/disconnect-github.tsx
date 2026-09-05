"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Unplug } from "lucide-react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, messageFor } from "@/lib/client/api-client";

/** Danger zone: revokes the OAuth grant and deletes all GreenGrid data. */
export function DisconnectGitHub({ username }: { username: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);

  async function disconnect() {
    setIsPending(true);
    try {
      await apiFetch("/api/settings", { method: "DELETE" });
      router.replace("/");
      router.refresh();
    } catch (error) {
      toast.error(messageFor(error));
      setIsPending(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-muted-foreground">
          Disconnecting GitHub stops all future scheduled activity immediately. GreenGrid revokes
          its access token and deletes your schedules, repository selections and activity history.
          Commits already pushed to GitHub are not affected.
        </p>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="shrink-0" disabled={isPending}>
              <Unplug aria-hidden="true" />
              Disconnect GitHub
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect {username} from GreenGrid?</AlertDialogTitle>
              <AlertDialogDescription>
                All schedules stop running and your GreenGrid data is deleted. You can reconnect
                at any time, but your activity history will not be restored.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={disconnect}
                disabled={isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isPending ? "Disconnecting…" : "Disconnect GitHub"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
