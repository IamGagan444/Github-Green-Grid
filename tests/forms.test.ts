import { describe, expect, it } from "vitest";

import {
  ackEmail,
  checkFormToken,
  issueFormToken,
  MAX_FORM_AGE_MS,
  MIN_FILL_MS,
  originAllowed,
  renderAck,
  sheetHeaders,
  sheetRow,
  submissionAlert,
} from "@/lib/forms/submission";
import { parseBlocks } from "@/lib/hub/message";
import { fieldIdFromLabel, formFieldsSchema, submitterEmail, validateSubmission, type FormField } from "@/validators/form";

const SECRET = "test-secret";
const FIELDS: FormField[] = [
  { id: "name", label: "Your name", type: "text", required: true },
  { id: "email", label: "Email", type: "email", required: true },
  { id: "plan", label: "Plan", type: "select", required: false, options: ["Free", "Pro"] },
  { id: "age", label: "Age", type: "number", required: false },
  { id: "agree", label: "I agree", type: "checkbox", required: true },
  { id: "notes", label: "Notes", type: "textarea", required: false },
];

describe("form definitions", () => {
  it("derives unique field ids from labels", () => {
    const taken = new Set(["your_email"]);
    expect(fieldIdFromLabel("Your email", taken)).toBe("your_email_2");
    expect(fieldIdFromLabel("Café & notes!", new Set())).toBe("cafe_notes");
    expect(fieldIdFromLabel("!!!", new Set())).toBe("field");
  });

  it("rejects dropdowns without options and duplicate ids", () => {
    expect(formFieldsSchema.safeParse([{ id: "a", label: "A", type: "select", required: false }]).success).toBe(false);
    expect(
      formFieldsSchema.safeParse([
        { id: "a", label: "A", type: "text" },
        { id: "a", label: "B", type: "text" },
      ]).success,
    ).toBe(false);
  });
});

describe("validateSubmission", () => {
  const good = { name: "Asha", email: "asha@example.com", plan: "Pro", age: "31", agree: "on", notes: "Hi\nthere", extra: "dropped" };

  it("accepts valid answers and drops unknown keys", () => {
    const { values, errors } = validateSubmission(FIELDS, good);
    expect(errors).toEqual({});
    expect(values).toEqual({ name: "Asha", email: "asha@example.com", plan: "Pro", age: "31", agree: "Yes", notes: "Hi\nthere" });
  });

  it("reports each problem against its field", () => {
    const { errors } = validateSubmission(FIELDS, { name: " ", email: "nope", plan: "Enterprise", age: "lots" });
    expect(Object.keys(errors).sort()).toEqual(["age", "agree", "email", "name", "plan"]);
  });

  it("strips control characters and caps lengths", () => {
    const { values } = validateSubmission(FIELDS, { ...good, name: `A\u0000s\u0007ha${"x".repeat(1_000)}` });
    expect(values.name!.startsWith("Asha")).toBe(true);
    expect(values.name!.length).toBe(500);
  });

  it("finds the submitter's email for acknowledgements", () => {
    expect(submitterEmail(FIELDS, validateSubmission(FIELDS, good).values)).toBe("asha@example.com");
    expect(submitterEmail(FIELDS, { email: "bad" })).toBeNull();
  });
});

describe("form tokens", () => {
  const now = 1_800_000_000_000;
  const token = issueFormToken(SECRET, "form123abc", now);

  it("accepts a token used after the minimum fill time", () => {
    expect(checkFormToken(SECRET, "form123abc", token, now + MIN_FILL_MS + 1)).toBe("ok");
  });

  it("rejects instant, stale, tampered, missing or cross-form tokens", () => {
    expect(checkFormToken(SECRET, "form123abc", token, now + 100)).toBe("too_fast");
    expect(checkFormToken(SECRET, "form123abc", token, now + MAX_FORM_AGE_MS + 1)).toBe("expired");
    expect(checkFormToken(SECRET, "form123abc", `${now - 60_000}.${token.split(".")[1]}`, now)).toBe("invalid");
    expect(checkFormToken(SECRET, "otherform1", token, now + 5_000)).toBe("invalid");
    expect(checkFormToken("other-secret", "form123abc", token, now + 5_000)).toBe("invalid");
    expect(checkFormToken(SECRET, "form123abc", null)).toBe("missing");
  });
});

describe("originAllowed", () => {
  it("allows our own origin and everything when no list is set", () => {
    expect(originAllowed([], "https://evil.example", "https://app.example")).toBe(true);
    expect(originAllowed(["https://mysite.com"], "https://app.example", "https://app.example")).toBe(true);
  });

  it("enforces the list for other sites", () => {
    expect(originAllowed(["https://mysite.com"], "https://mysite.com", "https://app.example")).toBe(true);
    expect(originAllowed(["https://mysite.com"], "https://mysite.com.evil.example", "https://app.example")).toBe(false);
  });
});

describe("outputs", () => {
  const values = { name: "=HYPERLINK(\"https://evil\")", email: "a@b.co", plan: "", age: "", agree: "Yes", notes: "**bold** [x](https://evil.example)" };

  it("builds Sheet rows in column order, leaving formulas as text for RAW append", () => {
    expect(sheetHeaders(FIELDS)).toEqual(["Submitted at", "Your name", "Email", "Plan", "Age", "I agree", "Notes"]);
    const row = sheetRow(FIELDS, values, new Date("2026-10-17T10:00:00Z"));
    expect(row[0]).toBe("2026-10-17T10:00:00.000Z");
    expect(row[1]).toBe('=HYPERLINK("https://evil")');
  });

  it("escapes answers in the owner's alert so they can't add links or formatting", () => {
    const message = submissionAlert({ formName: "Contact", fields: FIELDS, values, sheetUrl: "https://docs.google.com/x", appUrl: "https://app.example", formId: "f1" });
    const nodes = parseBlocks(message.body).flatMap((block) => (block.type === "list" ? block.items.flat() : block.lines.flat()));
    expect(nodes.some((node) => node.type === "link")).toBe(false);
    expect(message.buttons.map((button) => button.label)).toEqual(["Open Sheet", "View form"]);
  });

  it("fills placeholders and keeps the subject on one line", () => {
    expect(renderAck("Hi {{ name }}, re: {{missing}}", { name: "Asha" })).toBe("Hi Asha, re: ");
    const email = ackEmail({ subject: "Thanks {{name}}\nBcc: x@evil", body: "<b>{{name}}</b>", values: { name: "Asha" } });
    expect(email.subject).toBe("Thanks Asha Bcc: x@evil");
    expect(email.html).toContain("&lt;b&gt;Asha&lt;/b&gt;");
    expect(email.text).toBe("<b>Asha</b>");
  });
});
