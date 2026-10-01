"use client";

import * as React from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/actions/action-state";
import { useActionToast } from "@/lib/client/use-action-toast";
import { cn } from "@/lib/utils";

export type FormAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

interface ConfirmActionProps {
  action: FormAction;
  /** Sent as hidden inputs; validated again by the action. */
  fields?: Record<string, string>;
  /** Omit for a controlled dialog opened elsewhere (e.g. from a menu). */
  triggerLabel?: string;
  triggerIcon?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  destructive?: boolean;
  variant?: "default" | "outline" | "destructive" | "ghost" | "secondary";
  size?: "default" | "sm";
}

/** Confirmation dialog whose confirm button submits a form bound to a Server Action. */
export function ConfirmAction({
  action,
  fields = {},
  triggerLabel,
  triggerIcon,
  open: controlledOpen,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working…",
  destructive = true,
  variant = "outline",
  size = "sm",
}: ConfirmActionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const [state, formAction, pending] = React.useActionState(action, IDLE_ACTION_STATE);
  useActionToast(state, () => setOpen(false));

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      {triggerLabel ? (
        <AlertDialogTrigger asChild>
          <Button variant={variant} size={size} disabled={pending}>
            {triggerIcon}
            {triggerLabel}
          </Button>
        </AlertDialogTrigger>
      ) : null}
      <AlertDialogContent>
        <form action={formAction} className="flex flex-col gap-4">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="submit"
              disabled={pending}
              className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            >
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * A single-button form bound to a Server Action. It is plain HTML until
 * hydration, so it submits even before (or without) client JavaScript.
 */
export function ActionButton({
  action,
  fields,
  children,
  variant = "outline",
  size = "sm",
  className,
  pendingLabel,
}: {
  action: FormAction;
  fields: Record<string, string>;
  children: React.ReactNode;
  variant?: "default" | "outline" | "destructive" | "ghost" | "secondary";
  size?: "default" | "sm";
  className?: string;
  pendingLabel?: string;
}) {
  const [state, formAction, pending] = React.useActionState(action, IDLE_ACTION_STATE);
  useActionToast(state);

  return (
    <form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size={size} disabled={pending} className={className}>
        {pending && pendingLabel ? pendingLabel : children}
      </Button>
    </form>
  );
}
