"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { ActionForm, CheckboxField, type FormAction } from "@/components/hub/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FIELD_TYPE_LABELS, FIELD_TYPES, fieldIdFromLabel, MAX_FIELDS, type FieldType, type FormField } from "@/validators/form";

export interface FormEditorValues {
  name: string;
  fields: FormField[];
  thankYouMessage: string;
  ackEnabled: boolean;
  ackSubject: string;
  ackBody: string;
  allowedOrigins: string[];
  channelIds: string[];
}

interface DraftField {
  key: number;
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string;
}

const NATIVE_SELECT =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

let nextKey = 1;

function toDraft(field: FormField): DraftField {
  return { key: nextKey++, id: field.id, label: field.label, type: field.type, required: field.required, options: (field.options ?? []).join(", ") };
}

/** Ids are kept for existing fields (so Sheet columns stay put) and derived from labels for new ones. */
function toFields(drafts: DraftField[]): FormField[] {
  const taken = new Set<string>();
  return drafts.map((draft) => {
    const id = draft.id || fieldIdFromLabel(draft.label, taken);
    taken.add(id);
    const options = draft.options
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
    return { id, label: draft.label.trim(), type: draft.type, required: draft.required, ...(draft.type === "select" ? { options } : {}) };
  });
}

export function FormEditor({
  action,
  initial,
  channels,
  submitLabel,
  successHref,
  fieldsLocked = false,
  hidden,
}: {
  action: FormAction;
  initial: FormEditorValues;
  channels: Array<{ id: string; label: string; kindLabel: string }>;
  submitLabel: string;
  successHref?: string;
  fieldsLocked?: boolean;
  /** Extra hidden inputs, e.g. the form id when editing. */
  hidden?: Record<string, string>;
}) {
  const [drafts, setDrafts] = React.useState<DraftField[]>(() => initial.fields.map(toDraft));
  const [ackEnabled, setAckEnabled] = React.useState(initial.ackEnabled);
  const update = (key: number, patch: Partial<DraftField>) => setDrafts((list) => list.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  const move = (index: number, by: -1 | 1) =>
    setDrafts((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });

  return (
    <ActionForm action={action} fields={hidden} submitLabel={submitLabel} pendingLabel="Saving…" successHref={successHref}>
      <input type="hidden" name="fields" value={JSON.stringify(toFields(drafts))} />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="form-name">Form name</Label>
            <Input id="form-name" name="name" defaultValue={initial.name} maxLength={80} required placeholder="Contact us" />
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">Fields</legend>
            {fieldsLocked ? (
              <p className="text-xs text-muted-foreground">This form has responses, so its fields are locked to keep the Sheet&apos;s columns lined up.</p>
            ) : null}
            {drafts.map((draft, index) => (
              <div key={draft.key} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <Input
                    value={draft.label}
                    onChange={(event) => update(draft.key, { label: event.target.value })}
                    placeholder="Question, e.g. Your email"
                    maxLength={100}
                    aria-label={`Field ${index + 1} label`}
                    disabled={fieldsLocked}
                  />
                  <select
                    className={NATIVE_SELECT}
                    value={draft.type}
                    onChange={(event) => update(draft.key, { type: event.target.value as FieldType })}
                    aria-label={`Field ${index + 1} type`}
                    disabled={fieldsLocked}
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {FIELD_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
                {draft.type === "select" ? (
                  <Input
                    value={draft.options}
                    onChange={(event) => update(draft.key, { options: event.target.value })}
                    placeholder="Options, separated by commas"
                    aria-label={`Field ${index + 1} options`}
                    disabled={fieldsLocked}
                  />
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.required}
                      onChange={(event) => update(draft.key, { required: event.target.checked })}
                      className="size-4 accent-primary"
                      disabled={fieldsLocked}
                    />
                    Required
                  </label>
                  {fieldsLocked ? null : (
                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => move(index, 1)} disabled={index === drafts.length - 1} aria-label="Move down">
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setDrafts((list) => list.filter((item) => item.key !== draft.key))}
                        disabled={drafts.length === 1}
                        aria-label="Remove field"
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {fieldsLocked || drafts.length >= MAX_FIELDS ? null : (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDrafts((list) => [...list, { key: nextKey++, id: "", label: "", type: "text", required: false, options: "" }])}
                >
                  <Plus aria-hidden="true" />
                  Add a field
                </Button>
              </div>
            )}
          </fieldset>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="form-thanks">Thank-you message</Label>
            <Input id="form-thanks" name="thankYouMessage" defaultValue={initial.thankYouMessage} maxLength={300} required />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Alert me on</legend>
            {channels.length === 0 ? (
              <p className="text-xs text-muted-foreground">No working channels yet. Responses still go to your Sheet.</p>
            ) : (
              channels.map((channel) => (
                <CheckboxField
                  key={channel.id}
                  name="channelIds"
                  value={channel.id}
                  label={channel.label}
                  description={channel.kindLabel}
                  defaultChecked={initial.channelIds.includes(channel.id)}
                />
              ))
            )}
          </fieldset>

          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="ackEnabled"
                checked={ackEnabled}
                onChange={(event) => setAckEnabled(event.target.checked)}
                className="size-4 accent-primary"
              />
              Email people a confirmation
            </label>
            <p className="text-xs text-muted-foreground">
              Sent from your Gmail to the first email field. Use {"{{field_id}}"} to include an answer, e.g. {"{{your_name}}"}.
            </p>
            {ackEnabled ? (
              <>
                <Input name="ackSubject" defaultValue={initial.ackSubject} placeholder="Thanks for getting in touch" maxLength={150} aria-label="Email subject" />
                <Textarea name="ackBody" defaultValue={initial.ackBody} placeholder="Hi, we got your message and will reply within a day." rows={4} maxLength={2000} aria-label="Email body" />
              </>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="form-origins">Your website (optional)</Label>
            <Input
              id="form-origins"
              name="allowedOrigins"
              defaultValue={initial.allowedOrigins.join(", ")}
              placeholder="https://mysite.com"
              aria-describedby="form-origins-hint"
            />
            <p id="form-origins-hint" className="text-xs text-muted-foreground">
              Only needed to post from your own site&apos;s HTML. Leave blank to use the hosted link.
            </p>
          </div>
        </div>
      </div>
    </ActionForm>
  );
}
