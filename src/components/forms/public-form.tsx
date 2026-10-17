"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { FormField } from "@/validators/form";

interface PublicFormProps {
  publicId: string;
  fields: FormField[];
  token: string;
  thankYouMessage: string;
  /** Set when the no-JavaScript fallback redirected back here. */
  initialState?: "sent" | "error" | null;
  initialError?: string | null;
}

const NATIVE_SELECT =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * A real HTML form posting to /api/forms/<id>, so it works without
 * JavaScript. With JavaScript it posts JSON instead and shows errors inline.
 */
export function PublicForm({ publicId, fields, token, thankYouMessage, initialState = null, initialError = null }: PublicFormProps) {
  const [state, setState] = React.useState<"idle" | "sending" | "sent">(initialState === "sent" ? "sent" : "idle");
  const [message, setMessage] = React.useState<string | null>(initialState === "error" ? initialError : null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const action = `/api/forms/${encodeURIComponent(publicId)}`;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage(null);
    setErrors({});
    const data: Record<string, string> = {};
    new FormData(event.currentTarget).forEach((value, key) => {
      if (typeof value === "string" && !(key in data)) data[key] = value;
    });
    try {
      const response = await fetch(action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; errors?: Record<string, string> };
      if (response.ok && body.ok) {
        setState("sent");
        setMessage(body.message ?? thankYouMessage);
        return;
      }
      setErrors(body.errors ?? {});
      setMessage(body.message ?? "Something went wrong. Please try again.");
    } catch {
      setMessage("Couldn't reach the server. Check your connection and try again.");
    }
    setState("idle");
  }

  if (state === "sent") {
    return (
      <p role="status" className="rounded-md border border-border bg-secondary/40 px-4 py-6 text-center text-sm">
        {message ?? thankYouMessage}
      </p>
    );
  }

  return (
    <form method="post" action={action} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="_t" value={token} />
      {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {fields.map((field) => {
        const id = `f-${field.id}`;
        const error = errors[field.id];
        const describedBy = error ? `${id}-error` : undefined;
        const common = { id, name: field.id, required: field.required, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy };
        return (
          <div key={field.id} className="flex flex-col gap-2">
            {field.type === "checkbox" ? (
              <label htmlFor={id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" {...common} className="mt-0.5 size-4 accent-primary" />
                <span>
                  {field.label}
                  {field.required ? <span className="text-destructive"> *</span> : null}
                </span>
              </label>
            ) : (
              <>
                <Label htmlFor={id}>
                  {field.label}
                  {field.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                {field.type === "textarea" ? (
                  <Textarea {...common} rows={4} maxLength={5000} />
                ) : field.type === "select" ? (
                  <select {...common} className={NATIVE_SELECT} defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    {...common}
                    type={field.type === "phone" ? "tel" : field.type === "number" ? "number" : field.type === "email" ? "email" : "text"}
                    autoComplete={field.type === "email" ? "email" : field.type === "phone" ? "tel" : undefined}
                    maxLength={500}
                  />
                )}
              </>
            )}
            {error ? (
              <p id={describedBy} className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}

      {message ? (
        <p role="alert" className={cn("rounded-md border px-3 py-2 text-sm", "border-destructive/40 bg-destructive/5 text-destructive")}>
          {message}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Submit"}
        </Button>
      </div>
    </form>
  );
}
