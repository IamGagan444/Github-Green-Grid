import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { MAX_ATTEMPTS, processInstagramEvent, type EventOutcome } from "@/lib/instagram/engine";
import { matchAutomation } from "@/lib/instagram/matcher";
import { parseFollowGatePayload } from "@/lib/instagram/message";
import type { InboundEvent } from "@/lib/instagram/types";
import { createLogger } from "@/lib/logging/logger";
import { runWithBudget } from "@/lib/scheduler/due";
import { createEngineDeps } from "@/services/instagram-service";

const log = createLogger("instagram-events");

/** Events the webhook stored but has not finished after this long are swept by the cron. */
const STALE_AFTER_MS = 2 * 60_000;

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

/**
 * Stores the webhook events GreenGrid will act on and returns their ids.
 * Events with no matching active automation are dropped without storing any
 * personal data. Meta redeliveries hit the unique idempotency key and are skipped.
 */
export async function ingestInstagramEvents(events: readonly InboundEvent[]): Promise<Array<{ id: string; integrationId: string }>> {
  const created: Array<{ id: string; integrationId: string }> = [];
  const integrations = new Map<string, Awaited<ReturnType<typeof loadAccount>>>();

  for (const event of events) {
    if (!integrations.has(event.igUserId)) integrations.set(event.igUserId, await loadAccount(event.igUserId));
    const account = integrations.get(event.igUserId);
    if (!account) continue;

    let automationId: string | null = null;
    if (event.kind === "POSTBACK") {
      const originId = parseFollowGatePayload(event.payload);
      if (!originId) continue;
      const origin = await prisma.instagramEvent.findFirst({
        where: { id: originId, integrationId: account.id },
        select: { automationId: true },
      });
      if (!origin?.automationId) continue;
      automationId = origin.automationId;
    } else {
      const match = matchAutomation(event, account.automations);
      if (!match) continue;
      automationId = match.id;
    }

    const base = {
      integrationId: account.id,
      automationId,
      senderIgsid: event.senderIgsid,
      occurredAt: event.occurredAt,
    };
    const data: Prisma.InstagramEventUncheckedCreateInput =
      event.kind === "COMMENT"
        ? {
            ...base,
            idempotencyKey: `comment:${event.commentId}`,
            type: "COMMENT",
            sourceId: event.commentId,
            senderUsername: event.senderUsername,
            mediaId: event.mediaId,
            text: event.text,
          }
        : event.kind === "POSTBACK"
          ? { ...base, idempotencyKey: `postback:${event.mid}`, type: "POSTBACK", sourceId: event.mid, text: event.payload }
          : { ...base, idempotencyKey: `message:${event.mid}`, type: event.kind, sourceId: event.mid, text: event.text };

    try {
      const row = await prisma.instagramEvent.create({ data, select: { id: true } });
      created.push({ id: row.id, integrationId: account.id });
      if (event.kind !== "POSTBACK") {
        await prisma.instagramAutomation.update({
          where: { id: automationId },
          data: { triggeredCount: { increment: 1 } },
        });
      }
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }

  return created;
}

async function loadAccount(igUserId: string) {
  return prisma.instagramIntegration.findFirst({
    where: { igUserId, status: "CONNECTED" },
    select: {
      id: true,
      automations: {
        where: { status: "ACTIVE" },
        select: { id: true, trigger: true, mediaIds: true, keywords: true, matchMode: true, createdAt: true },
      },
    },
  });
}

/** Runs stored events. Safe to call concurrently: each event is leased before it runs. */
export async function runInstagramEvents(
  items: ReadonlyArray<{ id: string; integrationId: string }>,
  options: { deadline: number; concurrency?: number },
): Promise<Record<EventOutcome, number> & { deferred: number }> {
  const totals: Record<EventOutcome, number> = { SUCCESS: 0, FAILED: 0, SKIPPED: 0, RETRY: 0, BUSY: 0 };
  const depsByIntegration = new Map<string, ReturnType<typeof createEngineDeps>>();

  const { deferred } = await runWithBudget(
    items,
    async (item) => {
      let deps = depsByIntegration.get(item.integrationId);
      if (!deps) {
        deps = createEngineDeps(item.integrationId);
        depsByIntegration.set(item.integrationId, deps);
      }
      try {
        totals[await processInstagramEvent(deps, item.id)] += 1;
      } catch (error) {
        // Store failures: the lease expires and the cron picks the event up again.
        totals.FAILED += 1;
        log.error("instagram event crashed", { eventId: item.id, error: error as Error });
      }
    },
    { concurrency: options.concurrency ?? 3, deadline: options.deadline },
  );

  return { ...totals, deferred };
}

/** Cron sweep: retries that are due, and events whose webhook-time run never finished. */
export async function processDueInstagramEvents(deadline: number, now = new Date()) {
  const due = await prisma.instagramEvent.findMany({
    where: {
      status: "RUNNING",
      attempt: { lt: MAX_ATTEMPTS },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      AND: [
        {
          OR: [
            { nextRetryAt: { lte: now } },
            { nextRetryAt: null, createdAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
          ],
        },
      ],
    },
    select: { id: true, integrationId: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return runInstagramEvents(due, { deadline });
}
