import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { localDayKey } from "@/lib/automation/schedule";
import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { emailAddressSchema } from "@/lib/hub/channel-config";
import { createLogger } from "@/lib/logging/logger";
import type { Actor } from "@/lib/rbac";
import {
  CURRENCIES,
  firstReminderOn,
  nextReminderAfter,
  ownerReminderMessage,
  parseAmountToMinor,
  reminderEmail,
  upiIdSchema,
} from "@/lib/reminders/reminder";
import { getWallClock, isValidTimezone } from "@/lib/schedule/timezone";
import { runWithBudget } from "@/lib/scheduler/due";
import { NotPerformedError, type StepHandler } from "@/lib/workflow/types";
import { createGooglePort, getGoogleIntegration } from "@/services/google-service";
import { reserve } from "@/services/quota-service";
import { processRuns, registerStepHandlers } from "@/services/workflow-service";
import { createRunIfAbsent } from "@/services/workflow-store";

const log = createLogger("reminders");

const MAX_OPEN_RECEIVABLES = 100;
const MANUAL_BUCKET_MS = 10 * 60_000;
const DEFAULT_SETTINGS = {
  enabled: true,
  timezone: "Asia/Kolkata",
  hour: 10,
  upiId: null,
  payeeName: null,
  emailSubject: "Payment reminder: {amount} due {dueDate}",
  emailTemplate: "Hi {name},\n\nThis is a friendly reminder that {amount} is due on {dueDate}.\n\nThank you!",
  channelIds: [] as string[],
};

async function verifiedChannelIds(userId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.notificationChannel.findMany({ where: { userId, verified: true, id: { in: [...ids] } }, select: { id: true } });
  return rows.map((row) => row.id);
}

async function settingsFor(userId: string) {
  const settings = await prisma.reminderSettings.findUnique({ where: { userId } });
  if (settings) return settings;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultTimezone: true } });
  return { ...DEFAULT_SETTINGS, timezone: user?.defaultTimezone ?? DEFAULT_SETTINGS.timezone, lastRunDate: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings and receivables
// ─────────────────────────────────────────────────────────────────────────────

export async function getReminderSetup(userId: string) {
  const [settings, saved, open, closed] = await Promise.all([
    settingsFor(userId),
    prisma.reminderSettings.findUnique({ where: { userId }, select: { id: true } }),
    prisma.receivable.findMany({ where: { userId, status: "OPEN" }, orderBy: { dueDate: "asc" }, take: MAX_OPEN_RECEIVABLES }),
    prisma.receivable.findMany({ where: { userId, status: { not: "OPEN" } }, orderBy: { updatedAt: "desc" }, take: 20 }),
  ]);
  return { settings, saved: Boolean(saved), open, closed };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

export const reminderSettingsInputSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().refine(isValidTimezone, "Pick a valid time zone"),
  hour: z.coerce.number().int().min(0).max(23),
  upiId: z.union([z.literal(""), upiIdSchema]).optional().transform((value) => value || null),
  payeeName: optionalText(50),
  emailSubject: z.string().trim().min(1, "Add a subject").max(150),
  emailTemplate: z.string().trim().min(1, "Add a message").max(2_000),
  channelIds: z.array(z.string().min(1).max(64)).max(10).default([]),
});

export async function saveReminderSettings(actor: Actor, raw: unknown): Promise<void> {
  const input = reminderSettingsInputSchema.parse(raw);
  const data = { ...input, channelIds: await verifiedChannelIds(actor.userId, input.channelIds) };
  await prisma.reminderSettings.upsert({ where: { userId: actor.userId }, create: { ...data, userId: actor.userId }, update: data });
}

export const receivableInputSchema = z
  .object({
    customerName: z.string().trim().min(1, "Add the customer's name").max(80),
    email: z.union([z.literal(""), emailAddressSchema]).optional().transform((value) => value || null),
    phone: z
      .string()
      .trim()
      .transform((value) => value.replace(/[\s()-]/g, ""))
      .pipe(z.union([z.literal(""), z.string().regex(/^\+[1-9]\d{6,14}$/, "Use the international format, e.g. +919876543210")]))
      .optional()
      .transform((value) => value || null),
    amount: z.string().trim().min(1, "Add the amount"),
    currency: z.enum(CURRENCIES).default("INR"),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date"),
    note: optionalText(200),
    paymentLink: z
      .union([z.literal(""), z.string().trim().url().max(500).refine((url) => url.startsWith("https://"), "Payment links must start with https://")])
      .optional()
      .transform((value) => value || null),
    intervalDays: z.coerce.number().int().min(1).max(30).default(3),
    maxReminders: z.coerce.number().int().min(1).max(10).default(3),
  })
  .refine((input) => input.email || input.phone, { message: "Add an email or a phone number so they can be reminded", path: ["email"] });

export async function addReceivable(actor: Actor, raw: unknown): Promise<string> {
  const input = receivableInputSchema.parse(raw);
  const amountMinor = parseAmountToMinor(input.amount, input.currency);
  if (amountMinor === null) throw new AppError("INTERNAL", "invalid amount", { userMessage: "Enter the amount as a number, like 1500 or 1500.50." });
  if ((await prisma.receivable.count({ where: { userId: actor.userId, status: "OPEN" } })) >= MAX_OPEN_RECEIVABLES) {
    throw new AppError("INTERNAL", "receivable limit", { userMessage: `You can track up to ${MAX_OPEN_RECEIVABLES} unpaid payments.` });
  }
  const settings = await settingsFor(actor.userId);
  const today = localDayKey(new Date(), settings.timezone);
  const { amount: _amount, ...rest } = input;
  const row = await prisma.receivable.create({
    data: { ...rest, userId: actor.userId, amountMinor, nextReminderOn: firstReminderOn(input.dueDate, today) },
    select: { id: true },
  });
  return row.id;
}

export async function setReceivableStatus(actor: Actor, id: string, status: "OPEN" | "PAID" | "CANCELLED"): Promise<void> {
  const settings = await settingsFor(actor.userId);
  const today = localDayKey(new Date(), settings.timezone);
  const existing = await prisma.receivable.findFirst({ where: { id, userId: actor.userId }, select: { dueDate: true, remindersSent: true, maxReminders: true } });
  if (!existing) throw new AppError("INTERNAL", "receivable not found", { userMessage: "That payment was not found." });
  await prisma.receivable.update({
    where: { id },
    data:
      status === "OPEN"
        ? { status, paidAt: null, nextReminderOn: existing.remindersSent < existing.maxReminders ? firstReminderOn(existing.dueDate, today) : null }
        : { status, paidAt: status === "PAID" ? new Date() : null, nextReminderOn: null },
  });
}

export async function deleteReceivable(actor: Actor, id: string): Promise<void> {
  const { count } = await prisma.receivable.deleteMany({ where: { id, userId: actor.userId } });
  if (count === 0) throw new AppError("INTERNAL", "receivable not found", { userMessage: "That payment was not found." });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sending
// ─────────────────────────────────────────────────────────────────────────────

type ReceivableRow = Awaited<ReturnType<typeof prisma.receivable.findMany>>[number];
type SettingsRow = Awaited<ReturnType<typeof settingsFor>>;

/** One reminder for one receivable: a run (customer email + owner copies), then the schedule advances. */
async function queueReminder(receivable: ReceivableRow, settings: SettingsRow, key: string, today: string, canEmail: boolean) {
  const channelIds = await verifiedChannelIds(receivable.userId, settings.channelIds);
  const willEmail = canEmail && Boolean(receivable.email);
  const reminderNumber = receivable.remindersSent + 1;
  const message = ownerReminderMessage({
    receivable,
    settings,
    reminderNumber,
    maxReminders: receivable.maxReminders,
    emailed: willEmail,
    appUrl: getAppUrl(),
  });
  const steps = [
    ...(willEmail ? [{ key: "reminder:email", idempotencyKey: `${key}:email`, semantics: "AT_MOST_ONCE" as const }] : []),
    ...channelIds.map((channelId) => ({ key: `notify:${channelId}`, idempotencyKey: `${key}:${channelId}`, payload: { channelId } })),
  ];
  if (steps.length === 0) return null;

  const run = await createRunIfAbsent({
    userId: receivable.userId,
    kind: "REMINDER",
    idempotencyKey: key,
    title: message.title,
    subjectType: "Receivable",
    subjectId: receivable.id,
    input: { message, receivableId: receivable.id } as unknown as Prisma.InputJsonValue,
    steps,
  });
  if (!run.created) return null;
  await prisma.receivable.update({
    where: { id: receivable.id },
    data: {
      remindersSent: reminderNumber,
      lastRemindedAt: new Date(),
      nextReminderOn: nextReminderAfter(today, reminderNumber, receivable.maxReminders, receivable.intervalDays),
    },
  });
  return { id: run.id, userId: receivable.userId };
}

/** Cron: once a day per user, at their chosen local hour, every open receivable whose reminder day has come. */
export async function runDueReminders(deadline: number, now = new Date()) {
  const users = await prisma.reminderSettings.findMany({
    where: { enabled: true, user: { status: "ACTIVE" } },
    take: 1_000,
  });
  const due = users.filter((settings) => {
    const today = localDayKey(now, settings.timezone);
    return settings.lastRunDate !== today && getWallClock(now, settings.timezone).hour >= settings.hour;
  });

  const queued: Array<{ id: string; userId: string }> = [];
  const { deferred } = await runWithBudget(
    due,
    async (settings) => {
      const today = localDayKey(now, settings.timezone);
      try {
        const canEmail = (await getGoogleIntegration(settings.userId)).canSendEmail;
        const receivables = await prisma.receivable.findMany({
          where: { userId: settings.userId, status: "OPEN", nextReminderOn: { lte: today } },
          take: MAX_OPEN_RECEIVABLES,
        });
        for (const receivable of receivables) {
          const run = await queueReminder(receivable, settings, `reminder:${receivable.id}:${receivable.remindersSent + 1}`, today, canEmail);
          if (run) queued.push(run);
        }
        await prisma.reminderSettings.update({ where: { userId: settings.userId }, data: { lastRunDate: today } });
      } catch (error) {
        log.error("reminder batch crashed", { userId: settings.userId, error: error as Error });
      }
    },
    { concurrency: 3, deadline },
  );

  const delivered = queued.length > 0 ? await processRuns(queued, { deadline }) : null;
  return { users: due.length, queued: queued.length, deferred, delivered: delivered?.SUCCESS ?? 0 };
}

/** "Remind now": sends the next reminder immediately (at most one per ten minutes per payment). */
export async function sendReminderNow(actor: Actor, id: string, now = new Date()): Promise<"sent" | "too_soon" | "nothing_to_send"> {
  const receivable = await prisma.receivable.findFirst({ where: { id, userId: actor.userId, status: "OPEN" } });
  if (!receivable) throw new AppError("INTERNAL", "receivable not open", { userMessage: "That payment isn't open." });
  const settings = await settingsFor(actor.userId);
  const today = localDayKey(now, settings.timezone);
  const bucket = new Date(Math.floor(now.getTime() / MANUAL_BUCKET_MS) * MANUAL_BUCKET_MS).toISOString();
  const key = `reminder:${receivable.id}:manual:${bucket}`;
  if (await prisma.workflowRun.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) return "too_soon";

  const canEmail = (await getGoogleIntegration(actor.userId)).canSendEmail;
  // A manual reminder may go past the automatic limit; it still counts toward it.
  const run = await queueReminder({ ...receivable, maxReminders: Math.max(receivable.maxReminders, receivable.remindersSent + 1) }, settings, key, today, canEmail);
  if (!run) return "nothing_to_send";
  await processRuns([run], { deadline: Date.now() + 20_000 });
  return "sent";
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow step
// ─────────────────────────────────────────────────────────────────────────────

const runInputSchema = z.object({ receivableId: z.string().min(1) });
const NOT_SENT_CODES = new Set(["GOOGLE_NOT_CONNECTED", "GOOGLE_TOKEN_REVOKED", "GOOGLE_PERMISSION_DENIED", "QUOTA_EXHAUSTED"]);

/** `reminder:email` — the customer's email, from the owner's Gmail. Skipped if paid in the meantime. */
const reminderEmailStep: StepHandler = {
  async run({ run }) {
    const { receivableId } = runInputSchema.parse(run.input);
    const receivable = await prisma.receivable.findFirst({ where: { id: receivableId, userId: run.userId } });
    if (!receivable || receivable.status !== "OPEN" || !receivable.email) return { status: "SKIPPED" };
    const settings = await settingsFor(run.userId);

    let reservation;
    try {
      reservation = await reserve("EMAILS", run.userId, 1);
    } catch (error) {
      if (error instanceof AppError) throw new NotPerformedError(error);
      throw error;
    }
    try {
      const sent = await createGooglePort(run.userId).sendEmail({
        to: receivable.email,
        ...reminderEmail(receivable, settings),
        fromName: settings.payeeName,
      });
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

registerStepHandlers("REMINDER", (_run, step) => (step.key === "reminder:email" ? reminderEmailStep : null));
