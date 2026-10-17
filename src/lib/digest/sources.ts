import { z } from "zod";

import type { DigestSourceKind } from "@/generated/prisma/enums";

/**
 * What a user can add to their morning digest. Everything is read from free,
 * public feeds: no API keys and no quota. YouTube and GitHub publish Atom
 * feeds; Hacker News is read from its official Firebase API.
 */

export const MAX_SOURCES_PER_USER = 10;
export const HN_TOP_MAX = 10;

const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

export const sourceConfigSchemas = {
  RSS: z.object({ url: z.string().url().max(2_000) }),
  YOUTUBE_CHANNEL: z.object({ channelId: z.string().regex(YOUTUBE_CHANNEL_ID) }),
  GITHUB_RELEASES: z.object({ owner: z.string().regex(GITHUB_NAME), repo: z.string().regex(GITHUB_NAME) }),
  HACKER_NEWS: z.object({ topN: z.number().int().min(1).max(HN_TOP_MAX) }),
} satisfies Record<DigestSourceKind, z.ZodType>;

export type SourceConfig<K extends DigestSourceKind> = z.infer<(typeof sourceConfigSchemas)[K]>;

export interface ParsedSourceInput {
  label: string;
  config: Record<string, unknown>;
}

export class SourceInputError extends Error {}

function asUrl(value: string): URL | null {
  try {
    return new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
}

/**
 * Turns what a person pastes (a URL, a channel link, `owner/repo`) into a
 * source config, or explains what to paste instead.
 */
export function parseSourceInput(kind: DigestSourceKind, rawValue: string, rawLabel = ""): ParsedSourceInput {
  const value = rawValue.trim();
  const label = rawLabel.trim().slice(0, 60);

  switch (kind) {
    case "RSS": {
      const url = asUrl(value);
      if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
        throw new SourceInputError("Paste the full feed URL, like https://example.com/feed.xml");
      }
      return { label: label || url.hostname.replace(/^www\./, ""), config: { url: url.toString() } };
    }

    case "YOUTUBE_CHANNEL": {
      const fromUrl = /\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(value)?.[1];
      const channelId = fromUrl ?? (YOUTUBE_CHANNEL_ID.test(value) ? value : null);
      if (!channelId) {
        throw new SourceInputError(
          "Paste the channel ID (starts with UC) or a youtube.com/channel/UC… link. On YouTube: channel → About → Share channel → Copy channel ID.",
        );
      }
      return { label: label || "YouTube channel", config: { channelId } };
    }

    case "GITHUB_RELEASES": {
      const path = value.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
      const [owner, repo] = path.split("/");
      if (!owner || !repo || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) {
        throw new SourceInputError("Use owner/repo, like vercel/next.js");
      }
      return { label: label || `${owner}/${repo} releases`, config: { owner, repo } };
    }

    case "HACKER_NEWS": {
      const topN = value === "" ? 5 : Number(value);
      if (!Number.isInteger(topN) || topN < 1 || topN > HN_TOP_MAX) {
        throw new SourceInputError(`Pick how many top stories to include (1–${HN_TOP_MAX}).`);
      }
      return { label: label || `Hacker News top ${topN}`, config: { topN } };
    }
  }
}

/** The feed URL for feed-backed sources; Hacker News has none. */
export function feedUrl(kind: DigestSourceKind, config: unknown): string | null {
  switch (kind) {
    case "RSS":
      return sourceConfigSchemas.RSS.parse(config).url;
    case "YOUTUBE_CHANNEL":
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${sourceConfigSchemas.YOUTUBE_CHANNEL.parse(config).channelId}`;
    case "GITHUB_RELEASES": {
      const { owner, repo } = sourceConfigSchemas.GITHUB_RELEASES.parse(config);
      return `https://github.com/${owner}/${repo}/releases.atom`;
    }
    case "HACKER_NEWS":
      return null;
  }
}

export const SOURCE_KIND_LABELS: Record<DigestSourceKind, string> = {
  RSS: "RSS / blog",
  YOUTUBE_CHANNEL: "YouTube channel",
  GITHUB_RELEASES: "GitHub releases",
  HACKER_NEWS: "Hacker News",
};
