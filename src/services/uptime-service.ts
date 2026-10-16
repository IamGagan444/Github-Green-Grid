import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logging/logger";
import { assertPublicUrl } from "@/lib/net/safe-fetch";
import type { Actor } from "@/lib/rbac";
import { runWithBudget } from "@/lib/scheduler/due";
import {
  CHECK_INTERVAL_MS,
  checkUrl,
  CONFIRM_DELAY_MS,
  evaluateCheck,
  getCertificateExpiry,
  tlsAlertDue,
  tlsMessage,
  uptimeMessage,
  type CheckResult,
} from "@/lib/uptime/monitor";
import { recordAudit } from "@/services/audit-service";
import { ingestEvent } from "@/services/notification-service";

const log = createLogger("uptime");

const MAX_MONITORS_PER_USER = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export const monitorInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  url: z.string().trim().url().max(500),
});

export async function listMonitors(userId: string) {
  return prisma.uptimeMonitor.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      label: true,
      url: true,
      enabled: true,
      state: true,
      lastCheckedAt: true,
      lastStatusCode: true,
      lastLatencyMs: true,
      lastError: true,
      lastChangeAt: true,
      tlsExpiresAt: true,
    },
  });
}

export async function createMonitor(actor: Actor, raw: unknown): Promise<string> {
  const input = monitorInputSchema.parse(raw);
  try {
    await assertPublicUrl(input.url);
  } catch {
    throw new AppError("URL_NOT_ALLOWED", "monitor url not public");
  }
  if ((await prisma.uptimeMonitor.count({ where: { userId: actor.userId } })) >= MAX_MONITORS_PER_USER) {
    throw new AppError("INTERNAL", "monitor limit", { userMessage: `You can monitor up to ${MAX_MONITORS_PER_USER} URLs.` });
  }
  const monitor = await prisma.uptimeMonitor.create({
    data: { userId: actor.userId, label: input.label, url: input.url },
    select: { id: true },
  });
  await recordAudit({ actorUserId: actor.userId, action: "MONITOR_CREATED", targetType: "UptimeMonitor", targetId: monitor.id });
  return monitor.id;
}

export async function setMonitorEnabled(actor: Actor, monitorId: string, enabled: boolean): Promise<void> {
  const { count } = await prisma.uptimeMonitor.updateMany({
    where: { id: monitorId, userId: actor.userId },
    // Re-enabling starts fresh so a stale state never produces a false "back up".
    data: enabled ? { enabled, state: "UNKNOWN", consecutiveFailures: 0, nextCheckAt: new Date() } : { enabled },
  });
  if (count === 0) throw new AppError("INTERNAL", "monitor not found", { userMessage: "That monitor was not found." });
}

export async function deleteMonitor(actor: Actor, monitorId: string): Promise<void> {
  const { count } = await prisma.uptimeMonitor.deleteMany({ where: { id: monitorId, userId: actor.userId } });
  if (count === 0) throw new AppError("INTERNAL", "monitor not found", { userMessage: "That monitor was not found." });
  await recordAudit({ actorUserId: actor.userId, action: "MONITOR_DELETED", targetType: "UptimeMonitor", targetId: monitorId });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Checks one monitor (with one confirmation retry before "down") and records the result. */
async function runCheck(monitor: {
  id: string;
  userId: string;
  url: string;
  label: string;
  state: "UNKNOWN" | "UP" | "DOWN";
  consecutiveFailures: number;
}): Promise<"up" | "down" | null> {
  let result: CheckResult = await checkUrl(monitor.url);
  if (!result.ok && monitor.state !== "DOWN") {
    await sleep(CONFIRM_DELAY_MS);
    result = await checkUrl(monitor.url);
  }

  const now = new Date();
  const transition = evaluateCheck(monitor, result);
  // Compare-and-swap on the previous state: two overlapping ticks cannot both alert.
  const { count } = await prisma.uptimeMonitor.updateMany({
    where: { id: monitor.id, state: monitor.state },
    data: {
      state: transition.state,
      consecutiveFailures: transition.consecutiveFailures,
      lastCheckedAt: now,
      nextCheckAt: new Date(now.getTime() + CHECK_INTERVAL_MS),
      lastStatusCode: result.statusCode,
      lastLatencyMs: result.latencyMs,
      lastError: result.error,
      ...(transition.change ? { lastChangeAt: now } : {}),
    },
  });
  if (count === 0 || !transition.change) return null;

  await ingestEvent({
    userId: monitor.userId,
    source: "UPTIME",
    type: transition.change === "down" ? "uptime.down" : "uptime.up",
    idempotencyKey: `uptime:${monitor.id}:${transition.change}:${now.getTime()}`,
    attrs: { monitorId: monitor.id, url: monitor.url },
    message: uptimeMessage(monitor, transition.change, result),
    occurredAt: now,
  });
  return transition.change;
}

/** Cron: every enabled monitor whose next check is due. */
export async function runDueChecks(deadline: number, now = new Date()) {
  const due = await prisma.uptimeMonitor.findMany({
    where: { enabled: true, nextCheckAt: { lte: now }, user: { status: "ACTIVE" } },
    select: { id: true, userId: true, url: true, label: true, state: true, consecutiveFailures: true },
    orderBy: { nextCheckAt: "asc" },
    take: 500,
  });

  let changes = 0;
  const { started, deferred } = await runWithBudget(
    due,
    async (monitor) => {
      try {
        if (await runCheck(monitor)) changes += 1;
      } catch (error) {
        log.error("uptime check crashed", { monitorId: monitor.id, error: error as Error });
      }
    },
    // Checks are I/O bound (≤ 10 s each), so they run wide.
    { concurrency: 20, deadline },
  );
  return { checked: started, deferred, changes };
}

/** Daily: TLS expiry for https monitors, alerting at 14 and 3 days. */
export async function runTlsChecks(deadline: number, now = new Date()) {
  const due = await prisma.uptimeMonitor.findMany({
    where: {
      enabled: true,
      url: { startsWith: "https://" },
      user: { status: "ACTIVE" },
      OR: [{ tlsCheckedAt: null }, { tlsCheckedAt: { lt: new Date(now.getTime() - DAY_MS + 60 * 60_000) } }],
    },
    select: { id: true, userId: true, url: true, label: true, tlsAlertLevel: true },
    take: 500,
  });

  let alerts = 0;
  await runWithBudget(
    due,
    async (monitor) => {
      try {
        const expiresAt = await getCertificateExpiry(monitor.url);
        if (!expiresAt) {
          await prisma.uptimeMonitor.update({ where: { id: monitor.id }, data: { tlsCheckedAt: now } });
          return;
        }
        const daysLeft = Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS);
        const { alert, level } = tlsAlertDue(daysLeft, monitor.tlsAlertLevel);
        await prisma.uptimeMonitor.update({
          where: { id: monitor.id },
          data: { tlsCheckedAt: now, tlsExpiresAt: expiresAt, tlsAlertLevel: level },
        });
        if (alert === null) return;
        alerts += 1;
        await ingestEvent({
          userId: monitor.userId,
          source: "UPTIME",
          type: "uptime.tls_expiring",
          idempotencyKey: `tls:${monitor.id}:${expiresAt.toISOString().slice(0, 10)}:${alert}`,
          attrs: { monitorId: monitor.id, url: monitor.url, daysLeft },
          message: tlsMessage(monitor, expiresAt, daysLeft),
          occurredAt: now,
        });
      } catch (error) {
        log.warn("tls check failed", { monitorId: monitor.id, error: error as Error });
      }
    },
    { concurrency: 10, deadline },
  );
  return { checked: due.length, alerts };
}
