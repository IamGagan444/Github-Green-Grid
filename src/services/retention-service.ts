import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Keeps the database inside Neon's free 0.5 GB. Everything is deleted in
 * small id batches so no statement holds locks for long, and the job stops at
 * its deadline (the next day continues where it left off).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 1_000;

export const RETENTION = {
  stepPayloadDays: 30,
  finishedRunDays: 30,
  failedRunDays: 90,
  eventDays: 30,
  formSubmissionDays: 90,
  cronRunDays: 30,
  quotaDays: 8,
} as const;

async function inBatches(deadline: number, load: () => Promise<string[]>, apply: (ids: string[]) => Promise<number>): Promise<number> {
  let total = 0;
  while (Date.now() < deadline) {
    const ids = await load();
    if (ids.length === 0) break;
    total += await apply(ids);
    if (ids.length < BATCH) break;
  }
  return total;
}

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

export async function runRetention(deadline: number, now = new Date()) {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const stepPayloads = await inBatches(
    deadline,
    async () =>
      ids(
        await prisma.workflowStep.findMany({
          where: { createdAt: { lt: before(RETENTION.stepPayloadDays) }, NOT: { payload: { equals: Prisma.DbNull } } },
          select: { id: true },
          take: BATCH,
        }),
      ),
    async (batch) => (await prisma.workflowStep.updateMany({ where: { id: { in: batch } }, data: { payload: Prisma.DbNull } })).count,
  );

  const runInputs = await inBatches(
    deadline,
    async () =>
      ids(
        await prisma.workflowRun.findMany({
          where: { createdAt: { lt: before(RETENTION.stepPayloadDays) }, NOT: { input: { equals: Prisma.DbNull } } },
          select: { id: true },
          take: BATCH,
        }),
      ),
    async (batch) => (await prisma.workflowRun.updateMany({ where: { id: { in: batch } }, data: { input: Prisma.DbNull } })).count,
  );

  const runs = await inBatches(
    deadline,
    async () =>
      ids(
        await prisma.workflowRun.findMany({
          where: {
            OR: [
              { status: { in: ["SUCCESS", "SKIPPED"] }, createdAt: { lt: before(RETENTION.finishedRunDays) } },
              { status: "FAILED", createdAt: { lt: before(RETENTION.failedRunDays) } },
            ],
          },
          select: { id: true },
          take: BATCH,
        }),
      ),
    async (batch) => (await prisma.workflowRun.deleteMany({ where: { id: { in: batch } } })).count,
  );

  const events = await inBatches(
    deadline,
    async () =>
      ids(
        await prisma.notificationEvent.findMany({
          where: { createdAt: { lt: before(RETENTION.eventDays) }, fannedOutAt: { not: null } },
          select: { id: true },
          take: BATCH,
        }),
      ),
    async (batch) => (await prisma.notificationEvent.deleteMany({ where: { id: { in: batch } } })).count,
  );

  // The Google Sheet is the owner's permanent record of each response.
  const submissions = await inBatches(
    deadline,
    async () =>
      ids(
        await prisma.formSubmission.findMany({
          where: { createdAt: { lt: before(RETENTION.formSubmissionDays) } },
          select: { id: true },
          take: BATCH,
        }),
      ),
    async (batch) => (await prisma.formSubmission.deleteMany({ where: { id: { in: batch } } })).count,
  );

  const [linkTokens, quota, cronRuns] = await Promise.all([
    prisma.telegramLinkToken.deleteMany({ where: { expiresAt: { lt: before(1) } } }),
    prisma.quotaUsage.deleteMany({ where: { updatedAt: { lt: before(RETENTION.quotaDays) } } }),
    prisma.cronRun.deleteMany({ where: { startedAt: { lt: before(RETENTION.cronRunDays) } } }),
  ]);

  return {
    stepPayloads,
    runInputs,
    runs,
    events,
    submissions,
    linkTokens: linkTokens.count,
    quota: quota.count,
    cronRuns: cronRuns.count,
  };
}
