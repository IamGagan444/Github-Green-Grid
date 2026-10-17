import crypto from "node:crypto";

import { XMLParser } from "fast-xml-parser";

/**
 * RSS 2.0, RSS 1.0 (RDF) and Atom parsing into one item shape.
 *
 * Entity processing is turned off in the parser: DOCTYPE-declared entities
 * are never expanded (no "billion laughs"), and only the five XML entities
 * plus numeric references are decoded, by hand, on the fields we keep.
 */

export interface FeedItem {
  /** Stable identity for de-duplication (guid / id / link). */
  id: string;
  title: string;
  url: string | null;
  publishedAt: Date | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return safeCodePoint(Number.parseInt(lower.slice(2), 16)) ?? match;
    if (lower.startsWith("#")) return safeCodePoint(Number.parseInt(lower.slice(1), 10)) ?? match;
    return NAMED_ENTITIES[lower] ?? match;
  });
}

function safeCodePoint(code: number): string | null {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : null;
}

/** Text content of a node that may be a string, a `{ "#text": … }` object or CDATA. */
function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if ("#text" in record) return text(record["#text"]);
    if ("__cdata" in record) return text(record.__cdata);
  }
  return "";
}

function cleanText(node: unknown, max = 300): string {
  const value = decodeEntities(text(node))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(decodeEntities(value.trim()));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function date(node: unknown): Date | null {
  const value = text(node).trim();
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Atom `<link>` elements: prefer rel="alternate" (or no rel) with an href. */
function atomLink(links: unknown): string | null {
  const list = Array.isArray(links) ? links : links ? [links] : [];
  const candidates = list
    .filter((link): link is Record<string, unknown> => Boolean(link) && typeof link === "object")
    .filter((link) => !link["@_rel"] || link["@_rel"] === "alternate");
  for (const link of candidates) {
    const href = typeof link["@_href"] === "string" ? httpUrl(link["@_href"]) : null;
    if (href) return href;
  }
  return null;
}

/** RSS `<link>` is text, but some feeds put an Atom link alongside it. */
function rssLink(links: unknown): string | null {
  const list = Array.isArray(links) ? links : links ? [links] : [];
  for (const link of list) {
    const href = typeof link === "string" ? httpUrl(link) : link && typeof link === "object" ? atomLink(link) : null;
    if (href) return href;
  }
  return null;
}

export class FeedParseError extends Error {}

export function parseFeed(xml: string): FeedItem[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new FeedParseError("not valid XML");
  }

  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    return ((feed.entry as unknown[]) ?? []).flatMap((raw) => {
      const entry = raw as Record<string, unknown>;
      const url = atomLink(entry.link);
      const title = cleanText(entry.title) || "(untitled)";
      const id = text(entry.id).trim() || url || title;
      return [{ id, title, url, publishedAt: date(entry.published ?? entry.updated) }];
    });
  }

  const channel = (doc.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  const rdf = doc["rdf:RDF"] as Record<string, unknown> | undefined;
  const items = (channel?.item ?? rdf?.item) as unknown[] | undefined;
  if (!channel && !rdf) throw new FeedParseError("not an RSS or Atom feed");

  return (items ?? []).flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const url = rssLink(item.link);
    const title = cleanText(item.title) || cleanText(item.description, 120) || "(untitled)";
    const id = text(item.guid).trim() || url || title;
    return [{ id, title, url, publishedAt: date(item.pubDate ?? item["dc:date"]) }];
  });
}

/** Short, stable hash of an item's identity, stored in `seenKeys`. */
export function itemKey(item: Pick<FeedItem, "id">): string {
  return crypto.createHash("sha256").update(item.id).digest("hex").slice(0, 24);
}

export const MAX_SEEN_KEYS = 300;

/**
 * Items not delivered before, newest first, at most `limit`. The first time a
 * source is read (no seen keys yet) only the newest `limit` items count as new,
 * so adding a blog with ten years of posts sends a handful, not thousands.
 */
export function selectNewItems(items: FeedItem[], seenKeys: readonly string[], limit: number): FeedItem[] {
  const seen = new Set(seenKeys);
  return [...items]
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .filter((item) => !seen.has(itemKey(item)))
    .slice(0, limit);
}

/** New keys first, capped, so the oldest memories fall off. */
export function mergeSeenKeys(seenKeys: readonly string[], delivered: FeedItem[], allCurrent: FeedItem[] = []): string[] {
  const fresh = [...delivered, ...allCurrent].map(itemKey);
  return [...new Set([...fresh, ...seenKeys])].slice(0, MAX_SEEN_KEYS);
}
