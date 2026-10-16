import {
  inlineToPlain,
  parseBlocks,
  SEVERITY_EMOJI,
  type Block,
  type HubButton,
  type HubMessage,
  type Inline,
} from "@/lib/hub/message";

/**
 * Per-channel renderers. Each one starts from the parsed markdown subset, so
 * escaping happens exactly once, for the target format.
 */

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram (parse_mode=HTML)
// ─────────────────────────────────────────────────────────────────────────────

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineToHtml(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeHtml(node.value);
        case "bold":
          return `<b>${inlineToHtml(node.children)}</b>`;
        case "italic":
          return `<i>${inlineToHtml(node.children)}</i>`;
        case "code":
          return `<code>${escapeHtml(node.value)}</code>`;
        case "link":
          return `<a href="${escapeHtml(node.url)}">${escapeHtml(node.label)}</a>`;
      }
    })
    .join("");
}

function blocksToTelegram(blocks: Block[]): string {
  return blocks
    .map((block) =>
      block.type === "list"
        ? block.items.map((item) => `• ${inlineToHtml(item)}`).join("\n")
        : block.lines.map(inlineToHtml).join("\n"),
    )
    .join("\n\n");
}

export interface TelegramRendered {
  text: string;
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> };
}

const TELEGRAM_MAX = 4_096;

export function renderTelegram(message: HubMessage): TelegramRendered {
  const title = `${SEVERITY_EMOJI[message.severity]} <b>${escapeHtml(message.title)}</b>`;
  const body = blocksToTelegram(parseBlocks(message.body));
  const footer = message.footer ? `\n\n<i>${escapeHtml(message.footer)}</i>` : "";
  let text = body ? `${title}\n\n${body}${footer}` : `${title}${footer}`;
  // Never cut through an HTML tag: fall back to plain text when too long.
  if (text.length > TELEGRAM_MAX) {
    // Escape first, then cut — and never through the middle of an entity like "&amp;".
    const escaped = escapeHtml(`${message.title}\n\n${renderPlainText(message)}`);
    text = escaped.length > TELEGRAM_MAX ? `${escaped.slice(0, TELEGRAM_MAX - 1).replace(/&[a-z]*$/, "")}…` : escaped;
  }

  const buttons: HubButton[] = [
    ...message.buttons,
    ...message.waLinks.map((link) => ({ label: `💬 ${link.label}`, url: link.url })),
  ];
  return buttons.length > 0
    ? { text, replyMarkup: { inline_keyboard: buttons.map((button) => [{ text: button.label, url: button.url }]) } }
    : { text };
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord (webhook embed)
// ─────────────────────────────────────────────────────────────────────────────

/** Discord markdown escaping, plus neutralising mentions even though allowed_mentions is empty. */
function escapeDiscord(value: string): string {
  return value.replace(/([\\*_`~|>[\]()#-])/g, "\\$1").replace(/@/g, "@\u200b");
}

function inlineToDiscord(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeDiscord(node.value);
        case "bold":
          return `**${inlineToDiscord(node.children)}**`;
        case "italic":
          return `*${inlineToDiscord(node.children)}*`;
        case "code":
          return `\`${node.value.replace(/`/g, "ˋ")}\``;
        case "link":
          return `[${escapeDiscord(node.label)}](${node.url})`;
      }
    })
    .join("");
}

const DISCORD_COLOR: Record<HubMessage["severity"], number> = {
  info: 0x3b82f6,
  success: 0x22c55e,
  warning: 0xf59e0b,
  critical: 0xef4444,
};

export interface DiscordPayload {
  username: string;
  allowed_mentions: { parse: never[] };
  embeds: Array<{
    title: string;
    description?: string;
    color: number;
    footer?: { text: string };
  }>;
}

export function renderDiscord(message: HubMessage): DiscordPayload {
  const body = parseBlocks(message.body)
    .map((block) =>
      block.type === "list"
        ? block.items.map((item) => `• ${inlineToDiscord(item)}`).join("\n")
        : block.lines.map(inlineToDiscord).join("\n"),
    )
    .join("\n\n");
  // Webhooks cannot carry link buttons, so they become links under the body.
  const links = [...message.buttons, ...message.waLinks]
    .map((button) => `[${escapeDiscord(button.label)}](${button.url})`)
    .join("  ·  ");
  const description = [body, links].filter(Boolean).join("\n\n");

  return {
    username: "GreenGrid",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: clip(`${SEVERITY_EMOJI[message.severity]} ${message.title}`, 256),
        ...(description ? { description: clip(description, 4_000) } : {}),
        color: DISCORD_COLOR[message.severity],
        ...(message.footer ? { footer: { text: clip(message.footer, 200) } } : {}),
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Slack (blocks + mrkdwn fallback text)
// ─────────────────────────────────────────────────────────────────────────────

/** Slack requires &, < and > escaped; with them escaped no <!channel> or <@U…> can be formed. */
function escapeSlack(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineToSlack(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeSlack(node.value);
        case "bold":
          return `*${inlineToSlack(node.children)}*`;
        case "italic":
          return `_${inlineToSlack(node.children)}_`;
        case "code":
          return `\`${escapeSlack(node.value.replace(/`/g, "ˋ"))}\``;
        case "link":
          return `<${node.url.replace(/[<>|]/g, encodeURIComponent)}|${escapeSlack(node.label).replace(/\|/g, "¦")}>`;
      }
    })
    .join("");
}

export interface SlackRendered {
  text: string;
  blocks: unknown[];
}

export function renderSlack(message: HubMessage): SlackRendered {
  const body = parseBlocks(message.body)
    .map((block) =>
      block.type === "list"
        ? block.items.map((item) => `• ${inlineToSlack(item)}`).join("\n")
        : block.lines.map(inlineToSlack).join("\n"),
    )
    .join("\n\n");
  const title = `${SEVERITY_EMOJI[message.severity]} ${message.title}`;
  const buttons = [...message.buttons, ...message.waLinks];

  const blocks: unknown[] = [{ type: "header", text: { type: "plain_text", text: clip(title, 150), emoji: true } }];
  if (body) blocks.push({ type: "section", text: { type: "mrkdwn", text: clip(body, 2_900) } });
  if (buttons.length > 0) {
    blocks.push({
      type: "actions",
      elements: buttons.map((button, index) => ({
        type: "button",
        action_id: `link_${index}`,
        text: { type: "plain_text", text: clip(button.label, 75), emoji: true },
        url: button.url,
      })),
    });
  }
  if (message.footer) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: escapeSlack(clip(message.footer, 200)) }] });
  }

  return { text: clip(`*${escapeSlack(title)}*${body ? `\n${body}` : ""}`, 3_000), blocks };
}

// ─────────────────────────────────────────────────────────────────────────────
// Email (HTML + plain text)
// ─────────────────────────────────────────────────────────────────────────────

export function renderPlainText(message: HubMessage): string {
  const body = parseBlocks(message.body)
    .map((block) =>
      block.type === "list"
        ? block.items.map((item) => `- ${inlineToPlain(item)}`).join("\n")
        : block.lines.map(inlineToPlain).join("\n"),
    )
    .join("\n\n");
  const links = [...message.buttons, ...message.waLinks].map((button) => `${button.label}: ${button.url}`).join("\n");
  return [body, links, message.footer].filter(Boolean).join("\n\n");
}

export interface EmailRendered {
  subject: string;
  html: string;
  text: string;
}

export function renderEmail(message: HubMessage): EmailRendered {
  const body = parseBlocks(message.body)
    .map((block) =>
      block.type === "list"
        ? `<ul style="padding-left:20px;margin:0 0 16px">${block.items
            .map((item) => `<li style="margin:0 0 4px">${inlineToHtml(item)}</li>`)
            .join("")}</ul>`
        : `<p style="margin:0 0 16px">${block.lines.map(inlineToHtml).join("<br>")}</p>`,
    )
    .join("");
  const buttons = [...message.buttons, ...message.waLinks]
    .map(
      (button) =>
        `<a href="${escapeHtml(button.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:8px 14px;border-radius:6px;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(button.label)}</a>`,
    )
    .join("");
  const footer = message.footer
    ? `<p style="margin:24px 0 0;color:#6b7280;font-size:12px">${escapeHtml(message.footer)}</p>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827"><div style="max-width:600px;margin:0 auto"><h2 style="margin:0 0 16px;font-size:18px">${escapeHtml(message.title)}</h2>${body}${buttons ? `<div>${buttons}</div>` : ""}${footer}</div></body></html>`;

  return { subject: clip(message.title, 200), html, text: renderPlainText(message) };
}
