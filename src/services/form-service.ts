import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hmacSha256Hex, randomToken } from "@/lib/encryption";
import { getAppUrl, getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  ackEmail,
  checkFormToken,
  HONEYPOT_FIELD,
  issueFormToken,
  originAllowed,
  sheetHeaders,
  sheetRow,
  submissionAlert,
} from "@/lib/forms/submission";
import { createLogger } from "@/lib/logging/logger";
import type { Actor } from "@/lib/rbac";
import { NotPerformedError, type StepHandler } from "@/lib/workflow/types";
import { formFieldsSchema, formInputSchema, submitterEmail, validateSubmission, type FormField, type FormInput } from "@/validators/form";
import { createGooglePort, getGoogleIntegration } from "@/services/google-service";
import { reserve } from "@/services/quota-service";
import { registerStepHandlers } from "@/services/workflow-service";
import { createRunIfAbsent } from "@/services/workflow-store";

const log = createLogger("forms");

const MAX_FORMS_PER_USER = 20;

function readFields(raw: unknown): FormField[] {
  const parsed = formFieldsSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("INTERNAL", "stored form fields invalid");
  return parsed.data;
}

function tokenSecret(): string {
  return `forms:${getEnv().AUTH_SECRET}`;
}

async function verifiedChannelIds(userId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.notificationChannel.findMany({
    where: { userId, verified: true, id: { in: [...ids] } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner side
// ─────────────────────────────────────────────────────────────────────────────

export async function listForms(userId: string) {
  return prisma.form.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, publicId: true, name: true, status: true, sheetUrl: true, submissionCount: true, createdAt: true },
  });
}

export async function getOwnedForm(userId: string, formId: string) {
  const form = await prisma.form.findFirst({
    where: { id: formId, userId },
    include: { submissions: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, data: true, createdAt: true } } },
  });
  if (!form) return null;
  return { ...form, fields: readFields(form.fields) };
}

async function requireSheets(userId: string): Promise<void> {
  const google = await getGoogleIntegration(userId);
  if (!google.canCreateSheets) {
    throw new AppError("GOOGLE_NOT_CONNECTED", "sheets scope missing", {
      userMessage: "Connect Google (with Sheets) in Settings → Connections first.",
    });
  }
}

export async function createForm(actor: Actor, raw: unknown): Promise<string> {
  const input = formInputSchema.parse(raw);
  await requireSheets(actor.userId);
  if ((await prisma.form.count({ where: { userId: actor.userId } })) >= MAX_FORMS_PER_USER) {
    throw new AppError("INTERNAL", "form limit", { userMessage: `You can have up to ${MAX_FORMS_PER_USER} forms.` });
  }
  const sheet = await createGooglePort(actor.userId).createSpreadsheet(`${input.name} · GreenGrid responses`, sheetHeaders(input.fields));
  const form = await prisma.form.create({
    data: {
      ...formData(input),
      channelIds: await verifiedChannelIds(actor.userId, input.channelIds),
      userId: actor.userId,
      publicId: randomToken(12),
      spreadsheetId: sheet.spreadsheetId,
      sheetUrl: sheet.url,
    },
    select: { id: true },
  });
  return form.id;
}

function formData(input: FormInput) {
  return {
    name: input.name,
    fields: input.fields as unknown as Prisma.InputJsonValue,
    thankYouMessage: input.thankYouMessage,
    ackEnabled: input.ackEnabled && Boolean(input.ackSubject && input.ackBody),
    ackSubject: input.ackSubject || null,
    ackBody: input.ackBody || null,
    allowedOrigins: input.allowedOrigins.map((origin) => new URL(origin).origin),
  };
}

export async function updateForm(actor: Actor, formId: string, raw: unknown): Promise<void> {
  const input = formInputSchema.parse(raw);
  const existing = await prisma.form.findFirst({
    where: { id: formId, userId: actor.userId },
    select: { id: true, fields: true, submissionCount: true },
  });
  if (!existing) throw new AppError("INTERNAL", "form not found", { userMessage: "That form was not found." });

  const oldHeaders = sheetHeaders(readFields(existing.fields)).join("\u0000");
  const fieldsChanged = oldHeaders !== sheetHeaders(input.fields).join("\u0000");
  // Columns are fixed once responses exist; changing them would misalign every row.
  if (fieldsChanged && existing.submissionCount > 0) {
    throw new AppError("INTERNAL", "fields locked", {
      userMessage: "This form already has responses, so its fields can't change. Create a new form instead.",
    });
  }

  let sheet: { spreadsheetId: string; url: string } | null = null;
  if (fieldsChanged) {
    await requireSheets(actor.userId);
    sheet = await createGooglePort(actor.userId).createSpreadsheet(`${input.name} · GreenGrid responses`, sheetHeaders(input.fields));
  }
  await prisma.form.update({
    where: { id: existing.id },
    data: {
      ...formData(input),
      channelIds: await verifiedChannelIds(actor.userId, input.channelIds),
      ...(sheet ? { spreadsheetId: sheet.spreadsheetId, sheetUrl: sheet.url } : {}),
    },
  });
}

export async function setFormStatus(actor: Actor, formId: string, active: boolean): Promise<void> {
  const { count } = await prisma.form.updateMany({
    where: { id: formId, userId: actor.userId },
    data: { status: active ? "ACTIVE" : "PAUSED" },
  });
  if (count === 0) throw new AppError("INTERNAL", "form not found", { userMessage: "That form was not found." });
}

export async function deleteForm(actor: Actor, formId: string): Promise<void> {
  const { count } = await prisma.form.deleteMany({ where: { id: formId, userId: actor.userId } });
  if (count === 0) throw new AppError("INTERNAL", "form not found", { userMessage: "That form was not found." });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public side
// ─────────────────────────────────────────────────────────────────────────────

export async function getPublicForm(publicId: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(publicId)) return null;
  const form = await prisma.form.findUnique({
    where: { publicId },
    select: { publicId: true, name: true, status: true, fields: true, thankYouMessage: true, user: { select: { status: true } } },
  });
  if (!form || form.user.status !== "ACTIVE") return null;
  if (form.status !== "ACTIVE") return { closed: true as const, name: form.name };
  return {
    closed: false as const,
    publicId: form.publicId,
    name: form.name,
    fields: readFields(form.fields),
    thankYouMessage: form.thankYouMessage,
    token: issueFormToken(tokenSecret(), form.publicId),
  };
}

export type SubmitOutcome =
  | { status: "accepted"; thankYouMessage: string; run: { id: string; userId: string } | null }
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "rejected"; reason: "not_found" | "origin" | "token" | "expired" };

export async function submitForm(
  publicId: string,
  raw: Record<string, unknown>,
  meta: { ip: string; origin: string | null; now?: Date },
): Promise<SubmitOutcome> {
  const now = meta.now ?? new Date();
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(publicId)) return { status: "rejected", reason: "not_found" };
  const form = await prisma.form.findUnique({
    where: { publicId },
    select: {
      id: true,
      userId: true,
      name: true,
      status: true,
      fields: true,
      thankYouMessage: true,
      spreadsheetId: true,
      sheetUrl: true,
      ackEnabled: true,
      allowedOrigins: true,
      channelIds: true,
      user: { select: { status: true } },
    },
  });
  if (!form || form.status !== "ACTIVE" || form.user.status !== "ACTIVE") return { status: "rejected", reason: "not_found" };

  const ownOrigin = new URL(getAppUrl()).origin;
  if (!originAllowed(form.allowedOrigins, meta.origin, ownOrigin)) return { status: "rejected", reason: "origin" };

  // Bots fill the hidden field: pretend it worked and store nothing.
  if (typeof raw[HONEYPOT_FIELD] === "string" && raw[HONEYPOT_FIELD] !== "") {
    return { status: "accepted", thankYouMessage: form.thankYouMessage, run: null };
  }
  // Our own page always carries a signed timestamp. A plain HTML form on an
  // allow-listed site can't, so it relies on the honeypot and rate limits.
  const fromAllowedSite = Boolean(meta.origin && meta.origin !== ownOrigin && form.allowedOrigins.length > 0);
  if (!fromAllowedSite) {
    const token = checkFormToken(tokenSecret(), publicId, typeof raw._t === "string" ? raw._t : null, now.getTime());
    if (token === "expired") return { status: "rejected", reason: "expired" };
    if (token !== "ok") return { status: "rejected", reason: "token" };
  }

  const fields = readFields(form.fields);
  const { values, errors } = validateSubmission(fields, raw);
  if (Object.keys(errors).length > 0) return { status: "invalid", errors };

  const submission = await prisma.$transaction(async (tx) => {
    const created = await tx.formSubmission.create({
      data: {
        formId: form.id,
        userId: form.userId,
        data: values,
        ipHash: hmacSha256Hex(tokenSecret(), `ip:${meta.ip}`).slice(0, 32),
      },
      select: { id: true },
    });
    await tx.form.update({ where: { id: form.id }, data: { submissionCount: { increment: 1 } } });
    return created;
  });

  const key = `form:${submission.id}`;
  const channelIds = await verifiedChannelIds(form.userId, form.channelIds);
  const message = submissionAlert({ formName: form.name, fields, values, sheetUrl: form.sheetUrl, appUrl: getAppUrl(), formId: form.id });
  const steps = [
    ...(form.spreadsheetId ? [{ key: "sheet:append", idempotencyKey: `${key}:sheet`, semantics: "AT_LEAST_ONCE" as const }] : []),
    ...(form.ackEnabled && submitterEmail(fields, values)
      ? [{ key: "ack:email", idempotencyKey: `${key}:ack`, semantics: "AT_MOST_ONCE" as const }]
      : []),
    ...channelIds.map((channelId) => ({ key: `notify:${channelId}`, idempotencyKey: `${key}:${channelId}`, payload: { channelId } })),
  ];
  if (steps.length === 0) return { status: "accepted", thankYouMessage: form.thankYouMessage, run: null };

  const run = await createRunIfAbsent({
    userId: form.userId,
    kind: "FORM_SUBMISSION",
    idempotencyKey: key,
    title: message.title,
    subjectType: "FormSubmission",
    subjectId: submission.id,
    input: { message, submissionId: submission.id, formId: form.id } as unknown as Prisma.InputJsonValue,
    steps,
  });
  return { status: "accepted", thankYouMessage: form.thankYouMessage, run: { id: run.id, userId: form.userId } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow steps
// ─────────────────────────────────────────────────────────────────────────────

const runInputSchema = z.object({ submissionId: z.string().min(1), formId: z.string().min(1) });

/** Google rejected the call outright: nothing was sent, so even an at-most-once step may retry. */
const NOT_SENT_CODES = new Set(["GOOGLE_NOT_CONNECTED", "GOOGLE_TOKEN_REVOKED", "GOOGLE_PERMISSION_DENIED", "QUOTA_EXHAUSTED"]);

async function loadSubmission(userId: string, input: unknown) {
  const { submissionId, formId } = runInputSchema.parse(input);
  // Scoped to the run's owner, like every step.
  const submission = await prisma.formSubmission.findFirst({
    where: { id: submissionId, formId, userId },
    select: {
      data: true,
      createdAt: true,
      form: { select: { fields: true, spreadsheetId: true, ackEnabled: true, ackSubject: true, ackBody: true } },
    },
  });
  if (!submission) return null;
  return { ...submission, fields: readFields(submission.form.fields), values: z.record(z.string(), z.string()).parse(submission.data) };
}

const sheetAppendStep: StepHandler = {
  async run({ run }) {
    const submission = await loadSubmission(run.userId, run.input);
    if (!submission?.form.spreadsheetId) return { status: "SKIPPED" };
    const result = await createGooglePort(run.userId).appendRow(
      submission.form.spreadsheetId,
      sheetRow(submission.fields, submission.values, submission.createdAt),
    );
    return { result: { updatedRange: result.updatedRange } };
  },
};

const ackEmailStep: StepHandler = {
  async run({ run }) {
    const submission = await loadSubmission(run.userId, run.input);
    const to = submission ? submitterEmail(submission.fields, submission.values) : null;
    if (!submission || !to || !submission.form.ackEnabled || !submission.form.ackSubject || !submission.form.ackBody) {
      return { status: "SKIPPED" };
    }
    const email = ackEmail({ subject: submission.form.ackSubject, body: submission.form.ackBody, values: submission.values });
    let reservation;
    try {
      reservation = await reserve("EMAILS", run.userId, 1);
    } catch (error) {
      if (error instanceof AppError) throw new NotPerformedError(error);
      throw error;
    }
    try {
      const sent = await createGooglePort(run.userId).sendEmail({ to, ...email });
      return { externalId: sent.messageId };
    } catch (error) {
      if (error instanceof AppError && NOT_SENT_CODES.has(error.code)) {
        await reservation.release();
        throw new NotPerformedError(error);
      }
      throw error;
    }
  },
};

registerStepHandlers("FORM_SUBMISSION", (_run, step) => {
  if (step.key === "sheet:append") return sheetAppendStep;
  if (step.key === "ack:email") return ackEmailStep;
  log.warn("unknown form step", { step: step.key });
  return null;
});
