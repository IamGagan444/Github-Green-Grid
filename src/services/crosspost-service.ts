import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import type { CrossPostSourceKind } from "@/generated/prisma/enums";
import { completeOrSkip } from "@/lib/ai/port";
import {
  announcementMessage,
  approvalText,
  CALLBACK_APPROVE,
  CALLBACK_REJECT,
  crossPostTargetsSchema,
  draftPrompt,
  draftsSchema,
  parseCallback,
  parseDrafts,
  type CrossPostTargets,
  type Drafts,
} from "@/lib/crosspost/drafts";
import { parseSourceInput, SourceInputError } from "@/lib/digest/sources";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/encryption";
import { getAppUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { channelConfigSchemas } from "@/lib/hub/channel-config";
import { escapeHtml } from "@/lib/hub/render";
import { createLinkedInPost, LinkedInNotPostedError } from "@/lib/linkedin/client";
import { createLogger } from "@/lib/logging/logger";
import type { Actor } from "@/lib/rbac";
import { runWithBudget } from "@/lib/scheduler/due";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { NotPerformedError, type StepHandler } from "@/lib/workflow/types";
import { getAiPortForUser } from "@/services/ai-credential-service";
import { fetchSource } from "@/services/digest-service";
import { getLinkedInCredentials, getLinkedInIntegration, markLinkedInRevoked } from "@/services/linkedin-service";
import { reserve } from "@/services/quota-service";
import { extendTelegramBot } from "@/services/telegram-service";
import { processRuns, registerStepHandlers } from "@/services/workflow-service";
import { createRunIfAbsent } from "@/services/workflow-store";

const log = createLogger("crosspost");

const MAX_SOURCES_PER_USER = 5;
const POLL_INTERVAL_MS = 30 * 60_000;
const MAX_NEW_ITEMS_PER_POLL = 3;

const SOURCE_KIND = { YOUTUBE: "YOUTUBE_CHANNEL", RSS: "RSS" } as const satisfies Record<CrossPostSourceKind, "YOUTUBE_CHANNEL" | "RSS">;

function readTargets(raw: unknown): CrossPostTargets {
  return crossPostTargetsSchema.parse(raw ?? {});
}

async function verifiedChannels(userId: string, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return prisma.notificationChannel.findMany({
    where: { userId, verified: true, id: { in: [...ids] } },
    select: { id: true, label: true, kind: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────────

export async function getCrossPostSetup(userId: string) {
  const [sources, items, linkedin] = await Promise.all([
    prisma.crossPostSource.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.crossPostItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { source: { select: { label: true, kind: true } } },
    }),
    getLinkedInIntegration(userId),
  ]);
  const runs = await prisma.workflowRun.findMany({
    where: { userId, idempotencyKey: { in: items.map((item) => `crosspost:${item.id}`) } },
    select: { id: true, idempotencyKey: true, status: true },
  });
  const runByItem = new Map(runs.map((run) => [run.idempotencyKey.slice("crosspost:".length), run]));
  return {
    sources: sources.map((source) => ({ ...source, targets: readTargets(source.targets) })),
    items: items.map((item) => ({ ...item, drafts: draftsSchema.safeParse(item.drafts).data ?? null, run: runByItem.get(item.id) ?? null })),
    linkedin,
  };
}

export const crossPostSourceInputSchema = z.object({
  kind: z.enum(["YOUTUBE", "RSS"]),
  value: z.string().trim().min(1).max(2_000),
  label: z.string().trim().max(60).optional(),
  mode: z.enum(["APPROVAL", "AUTO"]).default("APPROVAL"),
  linkedin: z.boolean().default(false),
  channelIds: z.array(z.string().min(1).max(64)).max(10).default([]),
});

export async function addCrossPostSource(actor: Actor, raw: unknown): Promise<string> {
  const input = crossPostSourceInputSchema.parse(raw);
  let parsed;
  try {
    parsed = parseSourceInput(SOURCE_KIND[input.kind], input.value, input.label);
  } catch (error) {
    if (error instanceof SourceInputError) throw new AppError("INTERNAL", "invalid crosspost source", { userMessage: error.message });
    throw error;
  }
  if ((await prisma.crossPostSource.count({ where: { userId: actor.userId } })) >= MAX_SOURCES_PER_USER) {
    throw new AppError("INTERNAL", "crosspost source limit", { userMessage: `You can watch up to ${MAX_SOURCES_PER_USER} sources.` });
  }
  const targets = await normaliseTargets(actor.userId, { linkedin: input.linkedin, channelIds: input.channelIds });
  // Read it once now so a wrong address fails here, not silently later.
  await fetchSource({ kind: SOURCE_KIND[input.kind], config: parsed.config, etag: null, lastModified: null });

  const source = await prisma.crossPostSource.create({
    data: {
      userId: actor.userId,
      kind: input.kind,
      label: parsed.label,
      config: parsed.config as Prisma.InputJsonValue,
      mode: input.mode,
      targets: targets as unknown as Prisma.InputJsonValue,
      // Only things published from now on are posted: adding a channel never floods LinkedIn.
      baselineAt: new Date(),
      nextPollAt: new Date(),
    },
    select: { id: true },
  });
  return source.id;
}

async function normaliseTargets(userId: string, targets: CrossPostTargets): Promise<CrossPostTargets> {
  const channelIds = (await verifiedChannels(userId, targets.channelIds)).map((channel) => channel.id);
  if (targets.linkedin && !(await getLinkedInIntegration(userId)).canPost) {
    throw new AppError("LINKEDIN_NOT_CONNECTED", "linkedin target without connection", { userMessage: "Connect LinkedIn first, or untick it." });
  }
  if (!targets.linkedin && channelIds.length === 0) {
    throw new AppError("INTERNAL", "no crosspost targets", { userMessage: "Pick LinkedIn or at least one channel to post to." });
  }
  return { linkedin: targets.linkedin, channelIds };
}

export async function updateCrossPostSource(actor: Actor, sourceId: string, raw: unknown): Promise<void> {
  const input = z
    .object({ mode: z.enum(["APPROVAL", "AUTO"]), linkedin: z.boolean(), channelIds: z.array(z.string().min(1).max(64)).max(10), enabled: z.boolean() })
    .parse(raw);
  const targets = await normaliseTargets(actor.userId, input);
  const { count } = await prisma.crossPostSource.updateMany({
    where: { id: sourceId, userId: actor.userId },
    data: { mode: input.mode, enabled: input.enabled, targets: targets as unknown as Prisma.InputJsonValue, ...(input.enabled ? { failureCount: 0, lastError: null } : {}) },
  });
  if (count === 0) throw new AppError("INTERNAL", "source not found", { userMessage: "That source was not found." });
}

export async function deleteCrossPostSource(actor: Actor, sourceId: string): Promise<void> {
  const { count } = await prisma.crossPostSource.deleteMany({ where: { id: sourceId, userId: actor.userId } });
  if (count === 0) throw new AppError("INTERNAL", "source not found", { userMessage: "That source was not found." });
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling and drafting
// ─────────────────────────────────────────────────────────────────────────────

type SourceRow = Awaited<ReturnType<typeof prisma.crossPostSource.findMany>>[number];

async function draftFor(userId: string, item: { title: string; url: string }, source: SourceRow): Promise<Drafts> {
  const newItem = { title: item.title, url: item.url, kind: source.kind, sourceLabel: source.label };
  try {
    const result = await completeOrSkip(await getAiPortForUser(userId), { ...draftPrompt(newItem), maxTokens: 600, json: true });
    return parseDrafts(result?.content ?? null, newItem);
  } catch (error) {
    // A broken AI key never blocks posting; the plain draft is used instead.
    log.warn("crosspost draft failed", { userId, error: error as Error });
    return parseDrafts(null, newItem);
  }
}

/** Sends the Approve / Reject card to the user's Telegram chats. Returns the first message id. */
async function requestApproval(item: { id: string; userId: string; title: string; url: string }, drafts: Drafts, targets: CrossPostTargets): Promise<string | null> {
  const chats = await prisma.notificationChannel.findMany({
    where: { userId: item.userId, kind: "TELEGRAM", verified: true },
    select: { id: true, configEncrypted: true },
    take: 3,
  });
  if (chats.length === 0) return null;
  const channels = await verifiedChannels(item.userId, targets.channelIds);
  const text = approvalText(
    { title: item.title, url: item.url, drafts, targets: [...(targets.linkedin ? ["LinkedIn"] : []), ...channels.map((channel) => channel.label)] },
    escapeHtml,
  );
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `${CALLBACK_APPROVE}${item.id}` },
        { text: "✖ Reject", callback_data: `${CALLBACK_REJECT}${item.id}` },
      ],
      [{ text: "Edit in GreenGrid", url: `${getAppUrl()}/crosspost` }],
    ],
  };
  let firstId: string | null = null;
  for (const chat of chats) {
    try {
      const { chatId } = channelConfigSchemas.TELEGRAM.parse(JSON.parse(decryptSecret(chat.configEncrypted)));
      await reserve("TELEGRAM_MESSAGES", item.userId, 1);
      const sent = await sendTelegramMessage({ chatId, html: text, replyMarkup });
      firstId ??= String(sent.messageId);
    } catch (error) {
      log.warn("crosspost approval send failed", { itemId: item.id, error: error as Error });
    }
  }
  return firstId;
}

async function handleNewItem(item: { id: string; userId: string; title: string; url: string }, source: SourceRow): Promise<{ id: string; userId: string } | null> {
  const drafts = await draftFor(item.userId, item, source);
  const targets = readTargets(source.targets);
  if (source.mode === "AUTO") {
    await prisma.crossPostItem.update({ where: { id: item.id }, data: { drafts } });
    return publishItem(item.userId, item.id);
  }
  const approvalMessageId = await requestApproval(item, drafts, targets);
  await prisma.crossPostItem.update({ where: { id: item.id }, data: { drafts, status: "AWAITING_APPROVAL", approvalMessageId } });
  return null;
}

/** Cron: poll sources that are due, store new items, draft them, ask for approval or publish. */
export async function pollDueCrossPosts(deadline: number, now = new Date()) {
  const due = await prisma.crossPostSource.findMany({
    where: { enabled: true, nextPollAt: { lte: now }, user: { status: "ACTIVE" } },
    orderBy: { nextPollAt: "asc" },
    take: 200,
  });
  const queued: Array<{ id: string; userId: string }> = [];
  const { deferred } = await runWithBudget(
    due,
    async (source) => {
      try {
        const result = await fetchSource({ kind: SOURCE_KIND[source.kind], config: source.config, etag: source.etag, lastModified: source.lastModified });
        const fresh = result.items
          .filter((entry) => entry.url && entry.publishedAt && entry.publishedAt >= source.baselineAt)
          .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())
          .slice(0, MAX_NEW_ITEMS_PER_POLL);
        for (const entry of fresh) {
          const created = await prisma.crossPostItem
            .create({
              data: { sourceId: source.id, userId: source.userId, externalId: entry.id.slice(0, 500), title: entry.title.slice(0, 300), url: entry.url!, publishedAt: entry.publishedAt },
              select: { id: true, userId: true, title: true, url: true },
            })
            .catch(() => null); // Already seen (unique on source + external id).
          if (!created) continue;
          const run = await handleNewItem(created, source);
          if (run) queued.push(run);
        }
        await prisma.crossPostSource.update({
          where: { id: source.id },
          data: { etag: result.etag, lastModified: result.lastModified, lastPolledAt: now, nextPollAt: new Date(now.getTime() + POLL_INTERVAL_MS), failureCount: 0, lastError: null },
        });
      } catch (error) {
        const failures = source.failureCount + 1;
        await prisma.crossPostSource.update({
          where: { id: source.id },
          data: {
            lastPolledAt: now,
            // Back off up to six hours for a source that keeps failing.
            nextPollAt: new Date(now.getTime() + Math.min(POLL_INTERVAL_MS * 2 ** Math.min(failures, 4), 6 * 60 * 60_000)),
            failureCount: failures,
            lastError: (error instanceof AppError ? error.userMessage : "Couldn't read this source.").slice(0, 300),
          },
        });
      }
    },
    { concurrency: 4, deadline },
  );
  const delivered = queued.length > 0 ? await processRuns(queued, { deadline }) : null;
  return { polled: due.length, queued: queued.length, deferred, delivered: delivered?.SUCCESS ?? 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval and publishing
// ─────────────────────────────────────────────────────────────────────────────

/** Turns an item into a CROSSPOST_PUBLISH run (LinkedIn post + channel announcements). Idempotent per item. */
async function publishItem(userId: string, itemId: string): Promise<{ id: string; userId: string } | null> {
  const item = await prisma.crossPostItem.findFirst({ where: { id: itemId, userId }, include: { source: { select: { kind: true, targets: true } } } });
  if (!item) return null;
  const drafts = draftsSchema.safeParse(item.drafts).data;
  if (!drafts) return null;
  const targets = readTargets(item.source.targets);
  const channels = await verifiedChannels(userId, targets.channelIds);
  const key = `crosspost:${item.id}`;
  const steps = [
    ...(targets.linkedin ? [{ key: "linkedin:post", idempotencyKey: `${key}:linkedin`, semantics: "AT_MOST_ONCE" as const }] : []),
    ...channels.map((channel) => ({ key: `notify:${channel.id}`, idempotencyKey: `${key}:${channel.id}`, payload: { channelId: channel.id } })),
  ];
  if (steps.length === 0) {
    await prisma.crossPostItem.update({ where: { id: item.id }, data: { status: "FAILED" } });
    return null;
  }
  const message = announcementMessage({ title: item.title, url: item.url, kind: item.source.kind }, drafts);
  const run = await createRunIfAbsent({
    userId,
    kind: "CROSSPOST_PUBLISH",
    idempotencyKey: key,
    title: message.title,
    subjectType: "CrossPostItem",
    subjectId: item.id,
    input: { message, itemId: item.id } as unknown as Prisma.InputJsonValue,
    steps,
  });
  await prisma.crossPostItem.update({ where: { id: item.id }, data: { status: "APPROVED", approvedAt: item.approvedAt ?? new Date() } });
  return { id: run.id, userId };
}

export async function approveCrossPost(userId: string, itemId: string, edited?: Partial<Drafts>): Promise<"published" | "already" | "not_found"> {
  const item = await prisma.crossPostItem.findFirst({ where: { id: itemId, userId }, select: { id: true, status: true, drafts: true } });
  if (!item) return "not_found";
  if (item.status !== "AWAITING_APPROVAL" && item.status !== "NEW") return "already";
  if (edited) {
    const current = draftsSchema.safeParse(item.drafts).data ?? { linkedin: "", announcement: "" };
    const next = draftsSchema.parse({ ...current, ...Object.fromEntries(Object.entries(edited).filter(([, value]) => typeof value === "string" && value.trim())) });
    await prisma.crossPostItem.update({ where: { id: item.id }, data: { drafts: next } });
  }
  // Compare-and-swap so two quick taps on Approve publish once.
  const { count } = await prisma.crossPostItem.updateMany({
    where: { id: item.id, status: { in: ["AWAITING_APPROVAL", "NEW"] } },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  if (count === 0) return "already";
  const run = await publishItem(userId, item.id);
  if (run) await processRuns([run], { deadline: Date.now() + 20_000 });
  return "published";
}

export async function rejectCrossPost(userId: string, itemId: string): Promise<boolean> {
  const { count } = await prisma.crossPostItem.updateMany({
    where: { id: itemId, userId, status: { in: ["AWAITING_APPROVAL", "NEW"] } },
    data: { status: "REJECTED" },
  });
  return count > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow step
// ─────────────────────────────────────────────────────────────────────────────

const runInputSchema = z.object({ itemId: z.string().min(1) });

/** `linkedin:post` — at most once: a post LinkedIn may have created is never retried. */
const linkedInPostStep: StepHandler = {
  async run({ run }) {
    const { itemId } = runInputSchema.parse(run.input);
    const item = await prisma.crossPostItem.findFirst({ where: { id: itemId, userId: run.userId }, select: { title: true, url: true, drafts: true } });
    const drafts = item ? draftsSchema.safeParse(item.drafts).data : null;
    if (!item || !drafts) return { status: "SKIPPED" };

    let credentials;
    try {
      credentials = await getLinkedInCredentials(run.userId);
    } catch (error) {
      if (error instanceof AppError) throw new NotPerformedError(error);
      throw error;
    }
    try {
      const urn = await createLinkedInPost({ ...credentials, commentary: drafts.linkedin, url: item.url, title: item.title });
      return { externalId: urn.slice(0, 200) };
    } catch (error) {
      if (error instanceof LinkedInNotPostedError) {
        if (error.code === "LINKEDIN_TOKEN_REVOKED") await markLinkedInRevoked(run.userId);
        throw new NotPerformedError(error);
      }
      throw error;
    }
  },
};

registerStepHandlers("CROSSPOST_PUBLISH", (_run, step) => (step.key === "linkedin:post" ? linkedInPostStep : null));

// Approve / Reject buttons on the Telegram approval card.
extendTelegramBot({
  async handleCallback({ userIds, data }) {
    const parsed = parseCallback(data);
    if (!parsed) return "This button is no longer active.";
    const item = await prisma.crossPostItem.findUnique({ where: { id: parsed.itemId }, select: { userId: true } });
    // Only the owner's own linked chat may approve.
    if (!item || !userIds.includes(item.userId)) return "This post isn't yours to approve.";
    if (parsed.action === "reject") return (await rejectCrossPost(item.userId, parsed.itemId)) ? "Rejected. Nothing was posted." : "Already handled.";
    const outcome = await approveCrossPost(item.userId, parsed.itemId);
    return outcome === "published" ? "Approved. Posting now." : outcome === "already" ? "Already handled." : "This post no longer exists.";
  },
});
