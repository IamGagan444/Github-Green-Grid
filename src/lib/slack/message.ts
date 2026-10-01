/**
 * Slack message construction.
 *
 * AI output is data, not markup. Every bullet is escaped (&, <, >) before it is
 * placed in a message, which neutralises Slack control sequences such as
 * `<!channel>`, `<@U123>` mentions and `<https://evil|click here>` links. The
 * message structure (title, ✅ prefixes, line breaks) is produced here by the
 * application — the model cannot change it.
 */

/** Slack's documented escaping for message text. */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const LEADING_DECORATION = /^[\s\-*•·–—>#✅✔☑️✅✔️]+/u;

/**
 * Normalises one AI bullet into a plain single line:
 * strips list markers/emoji the model may have added, markdown emphasis
 * characters, and collapses whitespace. Returns "" if nothing meaningful is left.
 */
export function normaliseBullet(raw: string): string {
  let text = raw.replace(/[\r\n\t]+/g, " ");
  text = text.replace(LEADING_DECORATION, "");
  text = text.replace(/[*_~`]/g, "");
  text = text.replace(/\s{2,}/g, " ").trim();
  return text;
}

export interface UpdateMessageOptions {
  title?: string;
}

export const DEFAULT_UPDATE_TITLE = "Today's Update";

export function buildUpdateMessage(bullets: readonly string[], options: UpdateMessageOptions = {}): string {
  const title = options.title ?? DEFAULT_UPDATE_TITLE;
  const lines = bullets
    .map(normaliseBullet)
    .filter(Boolean)
    .map((bullet) => `✅ ${escapeSlackText(bullet)}`);
  return `*${escapeSlackText(title)}*\n\n${lines.join("\n")}`;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Wednesday, September 30, 2026" for a "YYYY-MM-DD" local day key. */
export function formatLongDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAY_NAMES[weekday]}, ${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

export const DEFAULT_HEADER_FORMAT = "📅 {date}";

/** Renders the parent date header. `{date}` is the only supported placeholder. */
export function buildDateHeader(dateKey: string, format: string = DEFAULT_HEADER_FORMAT): string {
  const safeFormat = format.includes("{date}") ? format : DEFAULT_HEADER_FORMAT;
  return escapeSlackText(safeFormat.replace("{date}", formatLongDate(dateKey)));
}

export function buildAiParent(dateKey: string, headline: string): string {
  return `📅 ${formatLongDate(dateKey)} — ${escapeSlackText(normaliseBullet(headline))}`;
}

