import { describe, expect, it } from "vitest";

import { parseBlocks } from "@/lib/hub/message";
import {
  firstReminderOn,
  formatAmount,
  formatDueDate,
  nextReminderAfter,
  ownerReminderMessage,
  parseAmountToMinor,
  reminderEmail,
  reminderText,
  renderReminderTemplate,
  upiIdSchema,
  type ReceivableLike,
  type ReminderSettingsLike,
} from "@/lib/reminders/reminder";

const receivable: ReceivableLike & { id: string } = {
  id: "r1",
  customerName: "Asha Traders",
  email: "asha@example.com",
  phone: "+919876543210",
  amountMinor: 150_050,
  currency: "INR",
  dueDate: "2026-10-20",
  note: "Invoice #42",
  paymentLink: "https://rzp.io/l/abc",
};

const settings: ReminderSettingsLike = {
  upiId: "gagan@okbank",
  payeeName: "Gagan Studio",
  emailSubject: "Payment reminder: {amount} due {dueDate}",
  emailTemplate: "Hi {name},\n\n{amount} for {note} is due on {dueDate}.",
};

describe("money", () => {
  it("parses amounts into minor units without floats", () => {
    expect(parseAmountToMinor("1,500.50", "INR")).toBe(150_050);
    expect(parseAmountToMinor("0.1", "USD")).toBe(10);
    expect(parseAmountToMinor("1500", "JPY")).toBe(1500);
  });

  it("rejects junk, zero and too many decimals", () => {
    expect(parseAmountToMinor("abc", "INR")).toBeNull();
    expect(parseAmountToMinor("0", "INR")).toBeNull();
    expect(parseAmountToMinor("10.555", "INR")).toBeNull();
    expect(parseAmountToMinor("-5", "INR")).toBeNull();
  });

  it("formats with the currency's own grouping and hides .00", () => {
    expect(formatAmount(150_050, "INR")).toBe("₹1,500.50");
    expect(formatAmount(1_00_000_00, "INR")).toBe("₹1,00,000");
    expect(formatAmount(2_500, "USD")).toBe("$25");
  });

  it("formats due dates the same everywhere", () => {
    expect(formatDueDate("2026-10-20")).toBe("20 Oct 2026");
  });
});

describe("UPI", () => {
  it("validates UPI ids", () => {
    expect(upiIdSchema.safeParse("gagan@okbank").success).toBe(true);
    expect(upiIdSchema.safeParse("not an id").success).toBe(false);
  });
});

describe("messages", () => {
  it("fills known placeholders and leaves unknown ones", () => {
    expect(renderReminderTemplate("{name} {amount} {oops}", { name: "A", amount: "₹1", dueDate: "", note: "", upiId: "", paymentLink: "" })).toBe("A ₹1 {oops}");
  });

  it("adds how to pay once, under the message", () => {
    const text = reminderText(receivable, settings);
    expect(text).toBe("Hi Asha Traders,\n\n₹1,500.50 for Invoice #42 is due on 20 Oct 2026.\n\nUPI: gagan@okbank\nPay online: https://rzp.io/l/abc");
    expect(reminderText(receivable, { ...settings, emailTemplate: "Pay {upiId}" })).not.toContain("UPI: gagan@okbank");
  });

  it("escapes the customer email and keeps the subject on one line", () => {
    const email = reminderEmail({ ...receivable, customerName: "<script>x</script>" }, { ...settings, emailSubject: "Due {dueDate}\nBcc: evil@x" });
    expect(email.subject).toBe("Due 20 Oct 2026 Bcc: evil@x");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Pay ₹1,500.50");
  });

  it("gives the owner a one-tap WhatsApp link with the reminder pre-filled", () => {
    const message = ownerReminderMessage({ receivable, settings, reminderNumber: 1, maxReminders: 3, emailed: true, appUrl: "https://app.example" });
    const wa = new URL(message.waLinks[0]!.url);
    expect(wa.host).toBe("wa.me");
    expect(wa.pathname).toBe("/919876543210");
    expect(wa.searchParams.get("text")).toContain("UPI: gagan@okbank");
    expect(message.buttons[0]?.url).toBe("https://app.example/reminders?paid=r1");
    const text = parseBlocks(message.body)
      .flatMap((block) => (block.type === "list" ? block.items.flat() : block.lines.flat()))
      .map((node) => ("value" in node ? node.value : ""))
      .join("");
    expect(text).toContain("emailed from your Gmail");
  });

  it("skips the WhatsApp button without a phone number", () => {
    expect(ownerReminderMessage({ receivable: { ...receivable, phone: null }, settings, reminderNumber: 1, maxReminders: 3, emailed: false, appUrl: "https://a.example" }).waLinks).toEqual([]);
  });
});

describe("schedule", () => {
  it("starts on the due date, or today when already overdue", () => {
    expect(firstReminderOn("2026-10-20", "2026-10-17")).toBe("2026-10-20");
    expect(firstReminderOn("2026-10-01", "2026-10-17")).toBe("2026-10-17");
  });

  it("spaces reminders and stops at the limit", () => {
    expect(nextReminderAfter("2026-10-20", 1, 3, 3)).toBe("2026-10-23");
    expect(nextReminderAfter("2026-10-30", 2, 3, 3)).toBe("2026-11-02");
    expect(nextReminderAfter("2026-10-26", 3, 3, 3)).toBeNull();
  });
});
