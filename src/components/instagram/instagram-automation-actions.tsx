"use client";

import * as React from "react";
import Link from "next/link";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";

import {
  deleteInstagramAutomationAction,
  setInstagramAutomationPausedAction,
} from "@/app/actions/instagram";
import { ConfirmAction } from "@/components/settings/confirm-action";
import { Button } from "@/components/ui/button";
import { IDLE_ACTION_STATE } from "@/lib/actions/action-state";
import { useActionToast } from "@/lib/client/use-action-toast";

/** Edit / Pause-Resume / Delete for one Instagram automation. */
export function InstagramAutomationActions({
  id,
  name,
  status,
}: {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
}) {
  const [pauseState, pauseAction, pausePending] = React.useActionState(
    setInstagramAutomationPausedAction,
    IDLE_ACTION_STATE,
  );
  useActionToast(pauseState);

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href={`/instagram/${id}/edit`}>
          <Pencil aria-hidden="true" />
          Edit
        </Link>
      </Button>
      {status !== "DISABLED" ? (
        <form action={pauseAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value={status === "ACTIVE" ? "pause" : "resume"} />
          <Button type="submit" variant="outline" size="sm" disabled={pausePending}>
            {status === "ACTIVE" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {status === "ACTIVE" ? "Pause" : "Resume"}
          </Button>
        </form>
      ) : null}
      <ConfirmAction
        action={deleteInstagramAutomationAction}
        fields={{ id }}
        triggerLabel="Delete"
        triggerIcon={<Trash2 aria-hidden="true" />}
        title={`Delete “${name}”?`}
        description="The automation and its activity log are deleted. Messages already sent stay in people's inboxes."
        confirmLabel="Delete automation"
      />
    </div>
  );
}
