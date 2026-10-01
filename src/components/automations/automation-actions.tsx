"use client";

import * as React from "react";
import Link from "next/link";
import { FlaskConical, MoreHorizontal, Pause, Pencil, Play, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteAutomationAction,
  runAutomationNowAction,
  setAutomationPausedAction,
} from "@/app/actions/automations";
import { ActionButton, ConfirmAction } from "@/components/settings/confirm-action";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IDLE_ACTION_STATE } from "@/lib/actions/action-state";
import { apiFetch, messageFor } from "@/lib/client/api-client";
import { useActionToast } from "@/lib/client/use-action-toast";
import type { PreviewResult } from "@/services/automation-service";
import { useAppDispatch } from "@/store/hooks";
import { showPreview } from "@/store/slices/test-preview-slice";

interface AutomationActionsProps {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
  canRun: boolean;
  /** Inline buttons (detail page) instead of a compact menu (cards). */
  layout?: "menu" | "inline";
}

/** Edit / Test / Run now / Pause-Resume / Delete, with confirmation for Run now and Delete. */
export function AutomationActions({ id, name, status, canRun, layout = "menu" }: AutomationActionsProps) {
  const dispatch = useAppDispatch();
  const [testing, setTesting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmRun, setConfirmRun] = React.useState(false);

  const disabled = status === "DISABLED";
  const pauseFields = { id, action: status === "ACTIVE" ? "pause" : "resume" };
  const pauseFormRef = React.useRef<HTMLFormElement>(null);
  const [pauseState, pauseAction, pausePending] = React.useActionState(setAutomationPausedAction, IDLE_ACTION_STATE);
  useActionToast(pauseState);

  async function test() {
    setTesting(true);
    try {
      const data = await apiFetch<{ preview: PreviewResult }>(`/api/automations/${id}/test`, { method: "POST" });
      dispatch(showPreview(data.preview));
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      setTesting(false);
    }
  }

  const dialogs = (
    <>
      <ConfirmAction
        action={runAutomationNowAction}
        fields={{ id }}
        open={confirmRun}
        onOpenChange={setConfirmRun}
        title="Post today's update now?"
        description="This posts to Slack for real and counts as today's update. The scheduled run will not post a second one today."
        confirmLabel="Post now"
        pendingLabel="Posting…"
        destructive={false}
      />
      <ConfirmAction
        action={deleteAutomationAction}
        fields={{ id }}
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${name}”?`}
        description="The automation stops and its configuration is removed. Past executions stay in your history."
        confirmLabel="Delete automation"
        pendingLabel="Deleting…"
      />
    </>
  );

  if (layout === "inline") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/automations/${id}/edit`}>
            <Pencil aria-hidden="true" />
            Edit
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={test} disabled={testing}>
          <FlaskConical aria-hidden="true" />
          {testing ? "Testing…" : "Test"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirmRun(true)} disabled={disabled || !canRun}>
          <Send aria-hidden="true" />
          Run now
        </Button>
        {disabled ? null : (
          <ActionButton action={setAutomationPausedAction} fields={pauseFields} pendingLabel="Saving…">
            {status === "ACTIVE" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {status === "ACTIVE" ? "Pause" : "Resume"}
          </ActionButton>
        )}
        <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)} className="text-destructive">
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
        {dialogs}
      </div>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${name}`} disabled={testing}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link href={`/automations/${id}/edit`}>
              <Pencil aria-hidden="true" />
              Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void test()}>
            <FlaskConical aria-hidden="true" />
            Test
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirmRun(true)} disabled={disabled || !canRun}>
            <Send aria-hidden="true" />
            Run now
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pauseFormRef.current?.requestSubmit()} disabled={disabled || pausePending}>
            {status === "ACTIVE" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {status === "ACTIVE" ? "Pause" : "Resume"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-destructive focus:text-destructive">
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Lives outside the menu so it survives the menu closing on select. */}
      <form ref={pauseFormRef} action={pauseAction} hidden>
        {Object.entries(pauseFields).map(([fieldName, value]) => (
          <input key={fieldName} type="hidden" name={fieldName} value={value} />
        ))}
      </form>
      {dialogs}
    </>
  );
}
