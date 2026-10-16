import { z } from "zod";

/**
 * The one message shape every channel renders. `body` uses a tiny markdown
 * subset — **bold**, _italic_, `code`, [text](https://url) and "- " bullets —
 * that each renderer translates and escapes for its target. Untrusted text
 * (PR titles, form answers, feed titles) must go through `md.text()` when a
 * body is composed, so it can never inject formatting, links or mentions.
 */

const httpUrl = z
  .string()
  .max(2_000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "must be an http(s) URL");

export const hubButtonSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: httpUrl,
});

export const hubMessageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(3_500).default(""),
  buttons: z.array(hubButtonSchema).max(5).default([]),
  /** One-tap WhatsApp links (https://wa.me/<number>?text=…). Sent by the owner, never by us. */
  waLinks: z.array(hubButtonSchema).max(3).default([]),
  severity: z.enum(["info", "success", "warning", "critical"]).default("info"),
  footer: z.string().max(200).optional(),
});

export type HubButton = z.infer<typeof hubButtonSchema>;
export type HubMessage = z.infer<typeof hubMessageSchema>;
export type HubMessageInput = z.input<typeof hubMessageSchema>;

export function hubMessage(input: HubMessageInput): HubMessage {
  return hubMessageSchema.parse(input);
}

// ─────────────────────────────────────────────────────────────────────────────
// Composition helpers
// ─────────────────────────────────────────────────────────────────────────────

const MARKDOWN_SPECIAL = /[\\*_`[\]()]/g;

export const md = {
  /** Untrusted text as a literal: markdown characters are escaped, newlines flattened. */
  text(value: string | null | undefined, maxLength = 300): string {
    const flat = (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
    const clipped = flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
    return clipped.replace(MARKDOWN_SPECIAL, (char) => `\\${char}`);
  },
  bold: (escaped: string) => `**${escaped}**`,
  italic: (escaped: string) => `_${escaped}_`,
  code: (value: string) => `\`${value.replace(/[`\r\n]/g, "")}\``,
  /** Link with an untrusted label; non-http(s) URLs degrade to plain text. */
  link(label: string, url: string): string {
    const safeLabel = md.text(label, 120);
    if (!httpUrl.safeParse(url).success) return safeLabel;
    const safeUrl = url.replace(/[()\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
    return `[${safeLabel}](${safeUrl})`;
  },
};

/** wa.me deep link with a pre-filled message. `phone` must be E.164. */
export function whatsAppLink(phoneE164: string, text: string): string | null {
  if (!/^\+[1-9]\d{6,14}$/.test(phoneE164)) return null;
  return `https://wa.me/${phoneE164.slice(1)}?text=${encodeURIComponent(text.slice(0, 1_000))}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing the markdown subset
// ─────────────────────────────────────────────────────────────────────────────

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; label: string; url: string };

export type Block = { type: "paragraph"; lines: Inline[][] } | { type: "list"; items: Inline[][] };

function findClosing(text: string, from: number, marker: string): number {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text.startsWith(marker, i)) return i;
  }
  return -1;
}

export function parseInline(text: string): Inline[] {
  const nodes: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) nodes.push({ type: "text", value: buffer });
    buffer = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === "\\" && i + 1 < text.length) {
      buffer += text[i + 1];
      i += 1;
      continue;
    }
    if (text.startsWith("**", i)) {
      const end = findClosing(text, i + 2, "**");
      if (end > i + 2) {
        flush();
        nodes.push({ type: "bold", children: parseInline(text.slice(i + 2, end)) });
        i = end + 1;
        continue;
      }
    }
    if (char === "_") {
      const end = findClosing(text, i + 1, "_");
      if (end > i + 1) {
        flush();
        nodes.push({ type: "italic", children: parseInline(text.slice(i + 1, end)) });
        i = end;
        continue;
      }
    }
    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ type: "code", value: text.slice(i + 1, end) });
        i = end;
        continue;
      }
    }
    if (char === "[") {
      const close = findClosing(text, i + 1, "]");
      if (close !== -1 && text[close + 1] === "(") {
        const end = text.indexOf(")", close + 2);
        const url = end === -1 ? "" : text.slice(close + 2, end);
        if (end !== -1 && httpUrl.safeParse(url).success) {
          flush();
          nodes.push({ type: "link", label: unescapeMarkdown(text.slice(i + 1, close)), url });
          i = end;
          continue;
        }
      }
    }
    buffer += char;
  }
  flush();
  return nodes;
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    if (lines.every((line) => /^\s*[-•]\s+/.test(line))) {
      blocks.push({ type: "list", items: lines.map((line) => parseInline(line.replace(/^\s*[-•]\s+/, ""))) });
    } else {
      blocks.push({ type: "paragraph", lines: lines.map((line) => parseInline(line)) });
    }
  }
  return blocks;
}

/** Plain-text rendering (email alternative part, notification previews). */
export function inlineToPlain(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "code":
          return node.value;
        case "bold":
        case "italic":
          return inlineToPlain(node.children);
        case "link":
          return `${node.label} (${node.url})`;
      }
    })
    .join("");
}

export const SEVERITY_EMOJI: Record<HubMessage["severity"], string> = {
  info: "🔔",
  success: "✅",
  warning: "⚠️",
  critical: "🚨",
};
