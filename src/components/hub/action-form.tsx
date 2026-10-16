"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/actions/action-state";
import { useActionToast } from "@/lib/client/use-action-toast";
import { cn } from "@/lib/utils";

export type FormAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

interface ActionFormProps {
  action: FormAction;
  children?: React.ReactNode;
  /** Hidden inputs; validated again by the action. */
  fields?: Record<string, string>;
  submitLabel: string;
  pendingLabel?: string;
  /** Clears the inputs after a success (forms that add something). */
  resetOnSuccess?: boolean;
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive";
  size?: "default" | "sm";
  icon?: React.ReactNode;
  className?: string;
}

/** A form bound to a Server Action, with a pending state and a toast for the result. */
export function ActionForm({
  action,
  children,
  fields = {},
  submitLabel,
  pendingLabel = "Working…",
  resetOnSuccess = false,
  variant = "default",
  size = "sm",
  icon,
  className,
}: ActionFormProps) {
  const [state, formAction, pending] = React.useActionState(action, IDLE_ACTION_STATE);
  const formRef = React.useRef<HTMLFormElement>(null);
  useActionToast(state, () => {
    if (resetOnSuccess) formRef.current?.reset();
  });

  return (
    <form ref={formRef} action={formAction} className={cn(children ? "flex flex-col gap-3" : "inline-flex", className)}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <div>
        <Button type="submit" variant={variant} size={size} disabled={pending}>
          {icon}
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Native select styled like the Input primitive (works inside plain forms). */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** A labelled native checkbox, for multi-value form fields. */
export function CheckboxField({
  name,
  value,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary/40">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-primary" />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
}
