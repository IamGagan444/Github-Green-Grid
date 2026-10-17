import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, IndianRupee, Plus, Settings2, Trash2 } from "lucide-react";

import {
  addReceivableAction,
  deleteReceivableAction,
  remindNowAction,
  saveReminderSettingsAction,
  setReceivableStatusAction,
} from "@/app/actions/reminders";
import { ActionForm, CheckboxField, NativeSelect } from "@/components/hub/action-form";
import { Header } from "@/components/layout/header";
import { ConfirmAction } from "@/components/settings/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { localDayKey } from "@/lib/automation/schedule";
import { requireUser } from "@/lib/auth";
import { CHANNEL_KIND_LABELS } from "@/lib/hub/channel-config";
import { CURRENCIES, formatAmount, formatDueDate } from "@/lib/reminders/reminder";
import { listSupportedTimezones } from "@/lib/schedule/timezone";
import { listChannels } from "@/services/channel-service";
import { getGoogleIntegration } from "@/services/google-service";
import { getReminderSetup } from "@/services/reminder-service";

export const metadata: Metadata = { title: "Payment reminders" };
export const dynamic = "force-dynamic";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? "AM" : "PM"}`;

export default async function RemindersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("notification:manage:own");
  const [query, { settings, saved, open, closed }, channels, google] = await Promise.all([
    searchParams,
    getReminderSetup(user.userId),
    listChannels(user.userId),
    getGoogleIntegration(user.userId),
  ]);
  const working = channels.filter((channel) => channel.verified);
  const today = localDayKey(new Date(), settings.timezone);
  const outstanding = open.reduce<Record<string, number>>((totals, row) => ({ ...totals, [row.currency]: (totals[row.currency] ?? 0) + row.amountMinor }), {});
  const highlighted = query.paid ? open.find((row) => row.id === query.paid) : undefined;

  return (
    <>
      <Header
        title="Payment reminders"
        description="Polite reminders from your Gmail on the due date, plus a one-tap WhatsApp message for you to send."
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        {highlighted ? (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-secondary/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p>
              Did <span className="font-medium">{highlighted.customerName}</span> pay {formatAmount(highlighted.amountMinor, highlighted.currency)}?
            </p>
            <ActionForm action={setReceivableStatusAction} fields={{ id: highlighted.id, status: "PAID" }} submitLabel="Yes, mark as paid" />
          </div>
        ) : null}

        {!google.canSendEmail ? (
          <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
            Reminder emails need Gmail.{" "}
            <Link href="/settings/connections" className="underline">
              Connect Google
            </Link>{" "}
            with Gmail sending. Until then you&apos;ll still get the WhatsApp button in your own channels.
          </p>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="size-4 text-primary" aria-hidden="true" />
                Add a payment to chase
              </CardTitle>
              <CardDescription>The first reminder goes out on the due date, then every few days until it&apos;s paid.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ActionForm action={addReceivableAction} submitLabel="Add" pendingLabel="Adding…" resetOnSuccess>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <Label htmlFor="r-name">Customer</Label>
                    <Input id="r-name" name="customerName" required maxLength={80} placeholder="Asha Traders" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="r-email">Email</Label>
                    <Input id="r-email" name="email" type="email" maxLength={254} placeholder="asha@example.com" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="r-phone">WhatsApp number</Label>
                    <Input id="r-phone" name="phone" type="tel" maxLength={20} placeholder="+919876543210" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="r-amount">Amount</Label>
                    <div className="flex gap-2">
                      <NativeSelect name="currency" defaultValue="INR" aria-label="Currency" className="w-24">
                        {CURRENCIES.map((currency) => (
                          <option key={currency} value={currency}>
                            {currency}
                          </option>
                        ))}
                      </NativeSelect>
                      <Input id="r-amount" name="amount" inputMode="decimal" required placeholder="1500" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="r-due">Due date</Label>
                    <Input id="r-due" name="dueDate" type="date" required defaultValue={today} />
                  </div>
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <Label htmlFor="r-note">What it&apos;s for (optional)</Label>
                    <Input id="r-note" name="note" maxLength={200} placeholder="Invoice #42, October design work" />
                  </div>
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <Label htmlFor="r-link">Payment link (optional)</Label>
                    <Input id="r-link" name="paymentLink" type="url" maxLength={500} placeholder="https://rzp.io/l/…" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="r-interval">Remind every</Label>
                    <NativeSelect id="r-interval" name="intervalDays" defaultValue="3">
                      {[1, 2, 3, 5, 7, 14].map((days) => (
                        <option key={days} value={days}>
                          {days} day{days === 1 ? "" : "s"}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="r-max">At most</Label>
                    <NativeSelect id="r-max" name="maxReminders" defaultValue="3">
                      {[1, 2, 3, 4, 5, 7, 10].map((count) => (
                        <option key={count} value={count}>
                          {count} reminder{count === 1 ? "" : "s"}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="size-4 text-primary" aria-hidden="true" />
                How reminders go out
              </CardTitle>
              <CardDescription>
                Placeholders: {"{name}"}, {"{amount}"}, {"{dueDate}"}, {"{note}"}, {"{upiId}"}, {"{paymentLink}"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ActionForm action={saveReminderSettingsAction} submitLabel="Save" pendingLabel="Saving…">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="size-4 accent-primary" />
                  Send reminders automatically
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="s-hour">Send at</Label>
                    <NativeSelect id="s-hour" name="hour" defaultValue={String(settings.hour)}>
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {hourLabel(hour)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="s-tz">Time zone</Label>
                    <NativeSelect id="s-tz" name="timezone" defaultValue={settings.timezone}>
                      {listSupportedTimezones().map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="s-upi">Your UPI ID</Label>
                    <Input id="s-upi" name="upiId" defaultValue={settings.upiId ?? ""} placeholder="yourname@okbank" maxLength={100} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="s-payee">Your name or business</Label>
                    <Input id="s-payee" name="payeeName" defaultValue={settings.payeeName ?? ""} maxLength={50} placeholder="Gagan Design Studio" />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="s-subject">Email subject</Label>
                  <Input id="s-subject" name="emailSubject" defaultValue={settings.emailSubject} maxLength={150} required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="s-body">Message</Label>
                  <Textarea id="s-body" name="emailTemplate" defaultValue={settings.emailTemplate} rows={5} maxLength={2000} required />
                </div>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">Send me a copy on</legend>
                  {working.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      <Link href="/notifications?tab=channels" className="underline">
                        Add a channel
                      </Link>{" "}
                      to get the one-tap WhatsApp button for each reminder.
                    </p>
                  ) : (
                    working.map((channel) => (
                      <CheckboxField
                        key={channel.id}
                        name="channelIds"
                        value={channel.id}
                        label={channel.label}
                        description={CHANNEL_KIND_LABELS[channel.kind]}
                        defaultChecked={saved ? settings.channelIds.includes(channel.id) : working.length === 1}
                      />
                    ))
                  )}
                </fieldset>
              </ActionForm>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IndianRupee className="size-4 text-primary" aria-hidden="true" />
              Unpaid
              {Object.entries(outstanding).map(([currency, total]) => (
                <Badge key={currency} variant="outline">
                  {formatAmount(total, currency)}
                </Badge>
              ))}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {open.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">Nobody owes you anything right now.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {open.map((row) => {
                  const overdue = row.dueDate < today;
                  return (
                    <li key={row.id} className="flex flex-col gap-2 px-3 py-3 lg:flex-row lg:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{row.customerName}</p>
                          <span className="text-sm tabular-nums">{formatAmount(row.amountMinor, row.currency)}</span>
                          {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Due {formatDueDate(row.dueDate)} · {row.remindersSent} of {row.maxReminders} reminders sent
                          {row.nextReminderOn ? ` · next ${formatDueDate(row.nextReminderOn)}` : " · no more scheduled"}
                          {row.note ? ` · ${row.note}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <ActionForm action={setReceivableStatusAction} fields={{ id: row.id, status: "PAID" }} submitLabel="Paid" />
                        <ActionForm
                          action={remindNowAction}
                          fields={{ id: row.id }}
                          submitLabel="Remind now"
                          pendingLabel="Sending…"
                          variant="outline"
                          icon={<BellRing aria-hidden="true" />}
                        />
                        <ActionForm action={setReceivableStatusAction} fields={{ id: row.id, status: "CANCELLED" }} submitLabel="Cancel" variant="ghost" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {closed.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Recently closed</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="divide-y divide-border rounded-md border border-border">
                {closed.map((row) => (
                  <li key={row.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{row.customerName}</p>
                        <span className="text-sm tabular-nums">{formatAmount(row.amountMinor, row.currency)}</span>
                        {row.status === "PAID" ? <Badge variant="success">Paid</Badge> : <Badge variant="outline">Cancelled</Badge>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <ActionForm action={setReceivableStatusAction} fields={{ id: row.id, status: "OPEN" }} submitLabel="Reopen" variant="outline" />
                      <ConfirmAction
                        action={deleteReceivableAction}
                        fields={{ id: row.id }}
                        triggerLabel="Delete"
                        triggerIcon={<Trash2 aria-hidden="true" />}
                        title={`Delete ${row.customerName}'s payment?`}
                        description="It's removed from your list. Reminders already sent aren't affected."
                        confirmLabel="Delete"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
