import { z } from "zod";

import { hubMessage, md, whatsAppLink, type HubMessage } from "@/lib/hub/message";
import { addDaysToDayKey } from "@/lib/schedule/timezone";

/**
 * Payment reminders: pure helpers for money, templates, UPI links and the
 * reminder schedule. Amounts are integers in minor units (paise, cents).
 */

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"] as const;
export type Currency = (typeof CURRENCIES)[number];

function fractionDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** "1,250.50" or "1250.5" → 125050 (for a 2-decimal currency). Null when it isn't a positive amount. */
export function parseAmountToMinor(raw: string, currency: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(cleaned)) return null;
  const digits = fractionDigits(currency);
  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || 0);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export function formatAmount(amountMinor: number, currency: string): string {
  const digits = fractionDigits(currency);
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", { style: "currency", currency, minimumFractionDigits: amountMinor % 10 ** digits === 0 ? 0 : digits }).format(
    amountMinor / 10 ** digits,
  );
}

/** "2026-10-20" → "20 Oct 2026", independent of the server's locale and zone. */
export function formatDueDate(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(Date.UTC(year, month - 1, day));
}

export const upiIdSchema = z.string().trim().regex(/^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/, "Enter a UPI ID like name@okbank");

export interface ReminderContext {
  name: string;
  amount: string;
  dueDate: string;
  note: string;
  upiId: string;
  paymentLink: string;
}

/** Fills {name}, {amount}, {dueDate}, {note}, {upiId} and {paymentLink}; unknown placeholders are left as typed. */
export function renderReminderTemplate(template: string, context: ReminderContext): string {
  return template.replace(/\{(name|amount|dueDate|note|upiId|paymentLink)\}/g, (_, key: keyof ReminderContext) => context[key]);
}

export interface ReceivableLike {
  customerName: string;
  email: string | null;
  phone: string | null;
  amountMinor: number;
  currency: string;
  dueDate: string;
  note: string | null;
  paymentLink: string | null;
}

export interface ReminderSettingsLike {
  upiId: string | null;
  payeeName: string | null;
  emailSubject: string;
  emailTemplate: string;
}

export function reminderContext(receivable: ReceivableLike, settings: ReminderSettingsLike): ReminderContext {
  return {
    name: receivable.customerName,
    amount: formatAmount(receivable.amountMinor, receivable.currency),
    dueDate: formatDueDate(receivable.dueDate),
    note: receivable.note ?? "",
    upiId: settings.upiId ?? "",
    paymentLink: receivable.paymentLink ?? "",
  };
}

/** The plain message to the customer: the template plus how to pay. */
export function reminderText(receivable: ReceivableLike, settings: ReminderSettingsLike): string {
  const context = reminderContext(receivable, settings);
  const body = renderReminderTemplate(settings.emailTemplate, context).trim();
  const ways = [
    ...(settings.upiId && receivable.currency === "INR" && !body.includes(settings.upiId) ? [`UPI: ${settings.upiId}`] : []),
    ...(receivable.paymentLink && !body.includes(receivable.paymentLink) ? [`Pay online: ${receivable.paymentLink}`] : []),
  ];
  return ways.length > 0 ? `${body}\n\n${ways.join("\n")}` : body;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function reminderEmail(receivable: ReceivableLike, settings: ReminderSettingsLike): { subject: string; html: string; text: string } {
  const context = reminderContext(receivable, settings);
  const subject = renderReminderTemplate(settings.emailSubject, context).replace(/[\r\n]+/g, " ").slice(0, 150);
  const text = reminderText(receivable, settings);
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 16px">${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const button =
    receivable.paymentLink && /^https?:\/\//.test(receivable.paymentLink)
      ? `<p style="margin:0 0 16px"><a href="${escapeHtml(receivable.paymentLink)}" style="display:inline-block;padding:8px 14px;border-radius:6px;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:600">Pay ${escapeHtml(context.amount)}</a></p>`
      : "";
  const html = `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827"><div style="max-width:600px;margin:0 auto">${paragraphs}${button}</div></body></html>`;
  return { subject, html, text };
}

/** The owner's copy: who was reminded, and a one-tap WhatsApp message to the customer. */
export function ownerReminderMessage(input: {
  receivable: ReceivableLike & { id: string };
  settings: ReminderSettingsLike;
  reminderNumber: number;
  maxReminders: number;
  emailed: boolean;
  appUrl: string;
}): HubMessage {
  const { receivable, settings } = input;
  const amount = formatAmount(receivable.amountMinor, receivable.currency);
  const wa = receivable.phone ? whatsAppLink(receivable.phone, reminderText(receivable, settings)) : null;
  const lines = [
    `${md.bold(md.text(receivable.customerName, 80))} owes ${md.bold(md.text(amount, 40))}, due ${md.text(formatDueDate(receivable.dueDate))}.`,
    input.emailed ? `Reminder ${input.reminderNumber} of ${input.maxReminders} was emailed from your Gmail.` : `Reminder ${input.reminderNumber} of ${input.maxReminders}.`,
    ...(wa ? ["Tap below to send it on WhatsApp too."] : []),
  ];
  return hubMessage({
    title: `Payment reminder: ${receivable.customerName}`.slice(0, 200),
    body: lines.join("\n"),
    waLinks: wa ? [{ label: `WhatsApp ${receivable.customerName}`.slice(0, 40), url: wa }] : [],
    buttons: [{ label: "Mark as paid", url: `${input.appUrl}/reminders?paid=${encodeURIComponent(input.receivable.id)}` }],
    severity: "info",
  });
}

/** First reminder: on the due date, or today if that's already passed. */
export function firstReminderOn(dueDate: string, today: string): string {
  return dueDate < today ? today : dueDate;
}

/** Day of the next reminder after one is sent, or null when the schedule is done. */
export function nextReminderAfter(sentOn: string, remindersSent: number, maxReminders: number, intervalDays: number): string | null {
  return remindersSent >= maxReminders ? null : addDaysToDayKey(sentOn, intervalDays);
}
