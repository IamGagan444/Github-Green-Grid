import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import type { DigestSourceKind } from "@/generated/prisma/enums";
import { completeOrSkip } from "@/lib/ai/port";
import { getDueRuns, localDayKey } from "@/lib/automation/schedule";
import { prisma } from "@/lib/db";
import { cleanSummary, composeDigest, countItems, ITEMS_PER_SOURCE, summaryPrompt, type DigestSection } from "@/lib/digest/compose";
import { FeedParseError, mergeSeenKeys, parseFeed, selectNewItems, type FeedItem } from "@/lib/digest/feed";
import { feedUrl, MAX_SOURCES_PER_USER, parseSourceInput, sourceConfigSchemas, SourceInputError } from "@/lib/digest/sources";
import { getAppUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { hubMessage } from "@/lib/hub/message";
import { createLogger } from "@/lib/logging/logger";
import { safeFetch } from "@/lib/net/safe-fetch";
import type { Actor } from "@/lib/rbac";
import { isValidTimezone, WEEKDAYS } from "@/lib/schedule/timezone";
import { runWithBudget } from "@/lib/scheduler/due";
import { formatLongDate } from "@/lib/slack/message";
import { getAiPortForUser } from "@/services/ai-credential-service";
import { extendTelegramBot } from "@/services/telegram-service";
import { processRuns } from "@/services/workflow-service";
import { createRunIfAbsent } from "@/services/workflow-store";

const log = createLogger("digest");

/** A digest more than three hours late is stale; it waits for the next slot instead. */
const GRACE_MINUTES = 180;
const FEED_MAX_BYTES = 1024 * 1024;
const FEED_TIMEOUT_MS = 10_000;
const MANUAL_BUCKET_MS = 10 * 60_000;
/** Sources that fail this many times in a row are reported, not retried silently forever. */
const FAILURES_BEFORE_WARNING = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Settings and sources
// ─────────────────────────────────────────────────────────────────────────────

export const digestSettingsInputSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time"),
  timezone: z.string().refine(isValidTimezone, "Pick a valid time zone"),
  daysOfWeek: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one day"),
  channelIds: z.array(z.string().min(1).max(64)).min(1, "Pick at least one channel").max(10),
});

export async function getDigestSetup(userId: string) {
  const [settings, sources, user] = await Promise.all([
    prisma.digestSettings.findUnique({ where: { userId } }),
    prisma.digestSource.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, label: true, enabled: true, lastFetchedAt: true, lastError: true, failureCount: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { defaultTimezone: true } }),
  ]);
  return { settings, sources, defaultTimezone: user?.defaultTimezone ?? "UTC" };
}

async function verifiedChannelIds(userId: string, ids: readonly string[]): Promise<string[]> {
  const rows = await prisma.notificationChannel.findMany({
    where: { userId, verified: true, id: { in: [...ids] } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function saveDigestSettings(actor: Actor, raw: unknown): Promise<void> {
  const input = digestSettingsInputSchema.parse(raw);
  const channelIds = await verifiedChannelIds(actor.userId, input.channelIds);
  if (channelIds.length === 0) {
    throw new AppError("CHANNEL_UNAVAILABLE", "no verified digest channels", { userMessage: "Pick at least one working channel." });
  }
  const data = {
    enabled: input.enabled,
    timezone: input.timezone,
    daysOfWeek: input.daysOfWeek,
    scheduleTimes: [input.time],
    channelIds,
  };
  await prisma.digestSettings.upsert({
    where: { userId: actor.userId },
    create: { ...data, userId: actor.userId },
    // A new time should not fire a "missed" run for a slot that already passed today.
    update: { ...data, lastRunAt: new Date() },
  });
}

export async function addDigestSource(actor: Actor, input: { kind: DigestSourceKind; value: string; label?: string }): Promise<string> {
  let parsed;
  try {
    parsed = parseSourceInput(input.kind, input.value, input.label);
  } catch (error) {
    if (error instanceof SourceInputError) throw new AppError("INTERNAL", "invalid digest source", { userMessage: error.message });
    throw error;
  }
  if ((await prisma.digestSource.count({ where: { userId: actor.userId } })) >= MAX_SOURCES_PER_USER) {
    throw new AppError("INTERNAL", "digest source limit", { userMessage: `You can add up to ${MAX_SOURCES_PER_USER} sources.` });
  }

  // Read it once now, so a typo fails here instead of silently at 8 a.m.
  const probe = await fetchSource({ kind: input.kind, config: parsed.config, etag: null, lastModified: null });
  if (input.kind !== "HACKER_NEWS" && probe.items.length === 0 && !probe.notModified) {
    throw new AppError("FETCH_FAILED", "empty feed", { userMessage: "That feed has no posts yet. Check the address and try again." });
  }

  const source = await prisma.digestSource.create({
    data: { userId: actor.userId, kind: input.kind, label: parsed.label, config: parsed.config as Prisma.InputJsonValue },
    select: { id: true },
  });
  return source.id;
}

export async function setDigestSourceEnabled(actor: Actor, sourceId: string, enabled: boolean): Promise<void> {
  const { count } = await prisma.digestSource.updateMany({
    where: { id: sourceId, userId: actor.userId },
    data: enabled ? { enabled, failureCount: 0, lastError: null } : { enabled },
  });
  if (count === 0) throw new AppError("INTERNAL", "source not found", { userMessage: "That source was not found." });
}

export async function deleteDigestSource(actor: Actor, sourceId: string): Promise<void> {
  const { count } = await prisma.digestSource.deleteMany({ where: { id: sourceId, userId: actor.userId } });
  if (count === 0) throw new AppError("INTERNAL", "source not found", { userMessage: "That source was not found." });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetching
// ─────────────────────────────────────────────────────────────────────────────

interface FetchResult {
  items: FeedItem[];
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
}

const USER_AGENT = "GreenGrid-Digest/1.0 (+https://github.com/IamGagan444/Github-Green-Grid)";

function fetchFailed(detail: string): AppError {
  return new AppError("FETCH_FAILED", detail, { userMessage: "Couldn't read this source. Check the address, or try again later." });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await safeFetch(url, { timeoutMs: FEED_TIMEOUT_MS, maxBytes: FEED_MAX_BYTES, headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!response.ok) throw fetchFailed(`json ${response.status}`);
  return JSON.parse(response.text()) as unknown;
}

const hnItemSchema = z.object({ id: z.number(), title: z.string().max(500).optional(), url: z.string().max(2_000).optional() });

async function fetchHackerNews(topN: number): Promise<FetchResult> {
  const ids = z.array(z.number()).parse(await fetchJson("https://hacker-news.firebaseio.com/v0/topstories.json")).slice(0, topN);
  const items = await Promise.all(
    ids.map(async (id): Promise<FeedItem | null> => {
      const item = hnItemSchema.safeParse(await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null));
      if (!item.success || !item.data.title) return null;
      const url = item.data.url && /^https?:\/\//.test(item.data.url) ? item.data.url : `https://news.ycombinator.com/item?id=${id}`;
      return { id: `hn:${id}`, title: item.data.title.slice(0, 300), url, publishedAt: null };
    }),
  );
  return { items: items.filter((item): item is FeedItem => item !== null), notModified: false, etag: null, lastModified: null };
}

async function fetchSource(source: { kind: DigestSourceKind; config: unknown; etag: string | null; lastModified: string | null }): Promise<FetchResult> {
  try {
    if (source.kind === "HACKER_NEWS") return await fetchHackerNews(sourceConfigSchemas.HACKER_NEWS.parse(source.config).topN);

    const url = feedUrl(source.kind, source.config);
    if (!url) throw fetchFailed("no feed url");
    const response = await safeFetch(url, {
      timeoutMs: FEED_TIMEOUT_MS,
      maxBytes: FEED_MAX_BYTES,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
        ...(source.etag ? { "If-None-Match": source.etag } : {}),
        ...(source.lastModified ? { "If-Modified-Since": source.lastModified } : {}),
      },
    });
    if (response.status === 304) return { items: [], notModified: true, etag: source.etag, lastModified: source.lastModified };
    if (!response.ok) throw fetchFailed(`feed ${response.status}`);
    return {
      items: parseFeed(response.text()),
      notModified: false,
      etag: response.headers.get("etag")?.slice(0, 200) ?? null,
      lastModified: response.headers.get("last-modified")?.slice(0, 100) ?? null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof FeedParseError) {
      throw new AppError("FETCH_FAILED", `feed parse: ${error.message}`, { userMessage: "That address isn't an RSS or Atom feed." });
    }
    throw fetchFailed(error instanceof Error ? error.name : "fetch error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Building and sending
// ─────────────────────────────────────────────────────────────────────────────

type SourceUpdate = { id: string; data: Prisma.DigestSourceUpdateInput };

async function collect(userId: string, deadline: number): Promise<{ sections: DigestSection[]; updates: SourceUpdate[] }> {
  const sources = await prisma.digestSource.findMany({
    where: { userId, enabled: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, label: true, config: true, etag: true, lastModified: true, seenKeys: true, failureCount: true },
  });
  const found: Array<{ position: number; section: DigestSection }> = [];
  const updates: SourceUpdate[] = [];

  await runWithBudget(
    sources.map((source, position) => ({ source, position })),
    async ({ source, position }) => {
      const now = new Date();
      try {
        const result = await fetchSource(source);
        const fresh = selectNewItems(result.items, source.seenKeys, ITEMS_PER_SOURCE);
        if (fresh.length > 0) found.push({ position, section: { label: source.label, items: fresh } });
        updates.push({
          id: source.id,
          data: {
            etag: result.etag,
            lastModified: result.lastModified,
            lastFetchedAt: now,
            failureCount: 0,
            lastError: null,
            // Everything currently in the feed counts as seen, so a busy feed shows its newest
            // few each day instead of an ever-growing backlog.
            ...(result.notModified ? {} : { seenKeys: mergeSeenKeys(source.seenKeys, fresh, result.items) }),
          },
        });
      } catch (error) {
        const message = error instanceof AppError ? error.userMessage : "Couldn't read this source.";
        updates.push({ id: source.id, data: { lastFetchedAt: now, failureCount: source.failureCount + 1, lastError: message.slice(0, 300) } });
        if (source.failureCount + 1 >= FAILURES_BEFORE_WARNING) log.warn("digest source keeps failing", { sourceId: source.id });
      }
    },
    { concurrency: 4, deadline },
  );

  // Keep the user's source order, whatever order the fetches finished in.
  const sections = found.sort((a, b) => a.position - b.position).map((entry) => entry.section);
  return { sections, updates };
}

async function summarise(userId: string, sections: DigestSection[]): Promise<string | null> {
  try {
    const port = await getAiPortForUser(userId);
    const result = await completeOrSkip(port, { ...summaryPrompt(sections), maxTokens: 250 });
    return result ? cleanSummary(result.content) : null;
  } catch (error) {
    // A broken AI key must never cost the user their digest; it just arrives without the summary.
    log.warn("digest summary failed", { userId, error: error as Error });
    return null;
  }
}

type DigestOutcome = { status: "queued"; runId: string } | { status: "empty" | "no_channels" | "no_sources" | "duplicate" };

async function sendDigest(input: {
  userId: string;
  key: string;
  timezone: string;
  channelIds: readonly string[];
  trigger: "SCHEDULED" | "MANUAL";
  deadline: number;
  now: Date;
}): Promise<DigestOutcome> {
  if (await prisma.workflowRun.findUnique({ where: { idempotencyKey: input.key }, select: { id: true } })) {
    return { status: "duplicate" };
  }
  const channelIds = await verifiedChannelIds(input.userId, input.channelIds);
  if (channelIds.length === 0) return { status: "no_channels" };
  if ((await prisma.digestSource.count({ where: { userId: input.userId, enabled: true } })) === 0) return { status: "no_sources" };

  const { sections, updates } = await collect(input.userId, input.deadline);
  const dateLabel = formatLongDate(localDayKey(input.now, input.timezone));

  let message;
  if (countItems(sections) === 0) {
    await applyUpdates(updates);
    if (input.trigger === "SCHEDULED") return { status: "empty" };
    // Asked for one explicitly: say so rather than staying silent.
    message = hubMessage({
      title: `Your digest · ${dateLabel}`,
      body: "Nothing new since your last digest.",
      buttons: [{ label: "Manage digest", url: `${getAppUrl()}/digest` }],
    });
  } else {
    message = composeDigest({ sections, dateLabel, summary: await summarise(input.userId, sections), appUrl: getAppUrl() });
  }

  const run = await createRunIfAbsent({
    userId: input.userId,
    kind: "DIGEST",
    idempotencyKey: input.key,
    title: message.title,
    trigger: input.trigger,
    scheduledFor: input.now,
    input: { message } as unknown as Prisma.InputJsonValue,
    steps: channelIds.map((channelId) => ({
      key: `notify:${channelId}`,
      idempotencyKey: `${input.key}:${channelId}`,
      payload: { channelId },
    })),
  });
  if (!run.created) return { status: "duplicate" };
  // Items are marked seen only once the digest that contains them exists.
  await applyUpdates(updates);
  return { status: "queued", runId: run.id };
}

async function applyUpdates(updates: SourceUpdate[]): Promise<void> {
  for (const update of updates) {
    await prisma.digestSource.updateMany({ where: { id: update.id }, data: update.data as Prisma.DigestSourceUpdateManyMutationInput });
  }
}

/** Cron: every enabled digest whose time has come today and hasn't been sent for that slot. */
export async function runDueDigests(deadline: number, now = new Date()) {
  const all = await prisma.digestSettings.findMany({
    where: { enabled: true, user: { status: "ACTIVE" }, NOT: { channelIds: { isEmpty: true } } },
    select: { userId: true, timezone: true, daysOfWeek: true, scheduleTimes: true, channelIds: true, lastRunAt: true },
    take: 1_000,
  });
  const due = all.flatMap((settings) => {
    const slots = getDueRuns(settings, now, GRACE_MINUTES).filter((slot) => !settings.lastRunAt || slot.scheduledFor > settings.lastRunAt);
    const latest = slots.at(-1);
    return latest ? [{ settings, slot: latest }] : [];
  });

  const queued: Array<{ id: string; userId: string }> = [];
  const { deferred } = await runWithBudget(
    due,
    async ({ settings, slot }) => {
      try {
        const outcome = await sendDigest({
          userId: settings.userId,
          key: `digest:${settings.userId}:${slot.executionDate}:${slot.slot}`,
          timezone: settings.timezone,
          channelIds: settings.channelIds,
          trigger: "SCHEDULED",
          deadline,
          now,
        });
        if (outcome.status === "queued") queued.push({ id: outcome.runId, userId: settings.userId });
        await prisma.digestSettings.update({
          where: { userId: settings.userId },
          data: { lastRunAt: now, lastRunDate: slot.executionDate },
        });
      } catch (error) {
        log.error("digest build crashed", { userId: settings.userId, error: error as Error });
      }
    },
    { concurrency: 3, deadline },
  );

  const delivered = queued.length > 0 ? await processRuns(queued, { deadline }) : null;
  return { due: due.length, queued: queued.length, deferred, delivered: delivered?.SUCCESS ?? 0 };
}

/** "Send now" in the app and /digest in Telegram. At most one per ten minutes. */
export async function requestDigestNow(userId: string, now = new Date()): Promise<"queued" | "not_configured" | "no_sources" | "too_soon"> {
  const settings = await prisma.digestSettings.findUnique({
    where: { userId },
    select: { timezone: true, channelIds: true },
  });
  if (!settings || settings.channelIds.length === 0) return "not_configured";

  const bucket = new Date(Math.floor(now.getTime() / MANUAL_BUCKET_MS) * MANUAL_BUCKET_MS).toISOString();
  const outcome = await sendDigest({
    userId,
    key: `digest:${userId}:manual:${bucket}`,
    timezone: settings.timezone,
    channelIds: settings.channelIds,
    trigger: "MANUAL",
    deadline: Date.now() + 25_000,
    now,
  });
  switch (outcome.status) {
    case "queued":
      await processRuns([{ id: outcome.runId, userId }], { deadline: Date.now() + 15_000 });
      return "queued";
    case "duplicate":
      return "too_soon";
    case "no_sources":
      return "no_sources";
    default:
      return "not_configured";
  }
}

// Telegram's /digest command.
extendTelegramBot({
  async requestDigest(userId) {
    const outcome = await requestDigestNow(userId);
    return outcome === "queued" || outcome === "too_soon" ? "queued" : "not_configured";
  },
});
