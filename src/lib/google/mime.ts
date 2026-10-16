import { emailAddressSchema } from "@/lib/hub/channel-config";

/**
 * RFC 2822 / MIME message for Gmail's users.messages.send. Header values are
 * stripped of CR/LF so no input can inject headers (Bcc, extra recipients);
 * addresses are validated; the subject is RFC 2047 encoded when non-ASCII.
 */

export interface MimeInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  /** Sender shown to the recipient; must be the authenticated account's own address. */
  from?: { name: string; address: string } | null;
}

export class InvalidEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEmailError";
  }
}

function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function address(value: string, field: string): string {
  const parsed = emailAddressSchema.safeParse(headerValue(value));
  if (!parsed.success) throw new InvalidEmailError(`invalid ${field} address`);
  return parsed.data;
}

export function encodeHeaderWord(value: string): string {
  const clean = headerValue(value);
  // Printable ASCII without characters that need quoting can go as-is.
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function displayName(value: string): string {
  const clean = headerValue(value).replace(/["\\]/g, "").slice(0, 80);
  return /^[\x20-\x7e]*$/.test(clean) ? `"${clean}"` : encodeHeaderWord(clean);
}

function base64Lines(value: string): string {
  return (
    Buffer.from(value, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? ""
  );
}

export function buildMimeMessage(input: MimeInput, boundary = `gg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`): string {
  const to = address(input.to, "to");
  const headers = [
    `To: ${to}`,
    ...(input.from ? [`From: ${displayName(input.from.name)} <${address(input.from.address, "from")}>`] : []),
    ...(input.replyTo ? [`Reply-To: ${address(input.replyTo, "reply-to")}`] : []),
    `Subject: ${encodeHeaderWord(input.subject.slice(0, 200))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  return [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Gmail's `raw` field: the whole message, base64url encoded. */
export function toGmailRaw(message: string): string {
  return Buffer.from(message, "utf8").toString("base64url");
}
