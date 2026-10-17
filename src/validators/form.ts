import { z } from "zod";

/**
 * Form definitions (stored as JSON on `forms.fields`) and the validation of
 * public submissions against them. Every value that reaches the Sheet, an
 * email or a chat message has passed through here first.
 */

export const FIELD_TYPES = ["text", "email", "phone", "textarea", "number", "select", "checkbox"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text",
  email: "Email",
  phone: "Phone",
  textarea: "Long text",
  number: "Number",
  select: "Dropdown",
  checkbox: "Checkbox",
};

export const MAX_FIELDS = 20;
const MAX_TEXT = 500;
const MAX_TEXTAREA = 5_000;

export const formFieldSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]{1,40}$/),
    label: z.string().trim().min(1, "Every field needs a label").max(100),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  })
  .refine((field) => field.type !== "select" || (field.options?.length ?? 0) >= 1, {
    message: "Dropdowns need at least one option",
    path: ["options"],
  });

export type FormField = z.infer<typeof formFieldSchema>;

export const formFieldsSchema = z
  .array(formFieldSchema)
  .min(1, "Add at least one field")
  .max(MAX_FIELDS, `Up to ${MAX_FIELDS} fields`)
  .refine((fields) => new Set(fields.map((field) => field.id)).size === fields.length, "Field ids must be unique");

export const formInputSchema = z.object({
  name: z.string().trim().min(1, "Give the form a name").max(80),
  fields: formFieldsSchema,
  thankYouMessage: z.string().trim().min(1).max(300).default("Thanks! We received your response."),
  ackEnabled: z.boolean().default(false),
  ackSubject: z.string().trim().max(150).optional(),
  ackBody: z.string().trim().max(2_000).optional(),
  allowedOrigins: z.array(z.string().url().max(200)).max(10).default([]),
  channelIds: z.array(z.string().min(1).max(64)).max(10).default([]),
});

export type FormInput = z.infer<typeof formInputSchema>;

/** Stable field id from a label: "Your email" → "your_email" (de-duplicated by the caller). */
export function fieldIdFromLabel(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "field";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`;
  return id;
}

const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/;
const PHONE = /^\+?[0-9 ()-]{6,20}$/;

/** Control characters other than newline/tab never belong in a submission. */
function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

export type SubmissionValues = Record<string, string>;

export interface SubmissionResult {
  values: SubmissionValues;
  errors: Record<string, string>;
}

/** Validates raw posted values against the form's fields. Unknown keys are dropped. */
export function validateSubmission(fields: readonly FormField[], raw: Record<string, unknown>): SubmissionResult {
  const values: SubmissionValues = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const input = raw[field.id];
    const text = typeof input === "string" ? input : Array.isArray(input) && typeof input[0] === "string" ? input[0] : "";

    if (field.type === "checkbox") {
      const checked = text === "on" || text === "true" || text === "yes";
      if (field.required && !checked) errors[field.id] = "Please tick this box.";
      values[field.id] = checked ? "Yes" : "No";
      continue;
    }

    const value = clean(text, field.type === "textarea" ? MAX_TEXTAREA : MAX_TEXT);
    if (!value) {
      if (field.required) errors[field.id] = "This field is required.";
      values[field.id] = "";
      continue;
    }
    if (field.type === "email" && !EMAIL.test(value)) errors[field.id] = "Enter a valid email address.";
    if (field.type === "phone" && !PHONE.test(value)) errors[field.id] = "Enter a valid phone number.";
    if (field.type === "number" && !Number.isFinite(Number(value))) errors[field.id] = "Enter a number.";
    if (field.type === "select" && !(field.options ?? []).includes(value)) errors[field.id] = "Pick one of the options.";
    values[field.id] = value;
  }
  return { values, errors };
}

/** The first email field's value, used for the optional acknowledgement. */
export function submitterEmail(fields: readonly FormField[], values: SubmissionValues): string | null {
  const field = fields.find((candidate) => candidate.type === "email" && EMAIL.test(values[candidate.id] ?? ""));
  return field ? values[field.id]! : null;
}
