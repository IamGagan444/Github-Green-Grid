import crypto from "node:crypto";

import { hubMessage, md, type HubMessage } from "@/lib/hub/message";
import type { FormField, SubmissionValues } from "@/validators/form";

/**
 * Pure helpers for public form submissions: bot protection, the Sheet row,
 * the owner's alert and the optional acknowledgement email.
 */

/** Submissions faster than this after the page loaded are almost always bots. */
export const MIN_FILL_MS = 2_000;
/** A form page older than this must be reloaded (stops replaying one token forever). */
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;
/** Hidden field real people never see or fill. */
export const HONEYPOT_FIELD = "website";

/** Signed "page rendered at" token: `<ms>.<hmac>`. Binds the timestamp to one form. */
export function issueFormToken(secret: string, publicId: string, now = Date.now()): string {
  const stamp = String(now);
  return `${stamp}.${crypto.createHmac("sha256", secret).update(`form:${publicId}:${stamp}`).digest("base64url")}`;
}

export type TokenCheck = "ok" | "missing" | "invalid" | "too_fast" | "expired";

export function checkFormToken(secret: string, publicId: string, token: string | null | undefined, now = Date.now()): TokenCheck {
  if (!token) return "missing";
  const [stamp, signature] = token.split(".", 2);
  if (!stamp || !signature || !/^\d{10,16}$/.test(stamp)) return "invalid";
  const expected = crypto.createHmac("sha256", secret).update(`form:${publicId}:${stamp}`).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return "invalid";
  const age = now - Number(stamp);
  if (age < MIN_FILL_MS) return "too_fast";
  if (age > MAX_FORM_AGE_MS) return "expired";
  return "ok";
}

/** Origin allow-list for forms posted from the owner's own site. Empty list = any origin. */
export function originAllowed(allowedOrigins: readonly string[], origin: string | null, ownOrigin: string): boolean {
  if (!origin || origin === ownOrigin || allowedOrigins.length === 0) return true;
  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === origin;
    } catch {
      return false;
    }
  });
}

export function sheetHeaders(fields: readonly FormField[]): string[] {
  return ["Submitted at", ...fields.map((field) => field.label)];
}

/** One Sheet row. GreenGrid appends with valueInputOption=RAW, so "=…" stays text. */
export function sheetRow(fields: readonly FormField[], values: SubmissionValues, submittedAt: Date): string[] {
  return [submittedAt.toISOString(), ...fields.map((field) => values[field.id] ?? "")];
}

export function submissionAlert(input: {
  formName: string;
  fields: readonly FormField[];
  values: SubmissionValues;
  sheetUrl: string | null;
  appUrl: string;
  formId: string;
}): HubMessage {
  const lines = input.fields
    .filter((field) => (input.values[field.id] ?? "") !== "")
    .slice(0, 12)
    .map((field) => `- ${md.bold(md.text(field.label, 60))}: ${md.text(input.values[field.id], 300)}`);
  return hubMessage({
    title: `New response: ${input.formName}`,
    body: lines.join("\n") || md.italic("Empty response"),
    buttons: [
      ...(input.sheetUrl ? [{ label: "Open Sheet", url: input.sheetUrl }] : []),
      { label: "View form", url: `${input.appUrl}/forms/${input.formId}` },
    ],
    severity: "info",
  });
}

/** Plain-text acknowledgement: `{{field_id}}` placeholders are filled with the submitter's own answers. */
export function renderAck(template: string, values: SubmissionValues): string {
  return template.replace(/\{\{\s*([a-z0-9_]{1,40})\s*\}\}/g, (_, id: string) => (values[id] ?? "").slice(0, 200));
}

export function ackEmail(input: { subject: string; body: string; values: SubmissionValues }): { subject: string; html: string; text: string } {
  const text = renderAck(input.body, input.values);
  const subject = renderAck(input.subject, input.values).replace(/[\r\n]+/g, " ").slice(0, 150);
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827"><div style="max-width:600px;margin:0 auto">${escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 16px">${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div></body></html>`;
  return { subject, html, text };
}
