import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging/logger";
import { isCronAuthorised } from "@/lib/scheduler/cron-auth";
import { runRetention } from "@/services/retention-service";
import { runTlsChecks } from "@/services/uptime-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const log = createLogger("cron-maintenance");

const BUDGET_MS = 45_000;
/** The job runs once a day however often the scheduler calls it. */
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * Daily maintenance: TLS certificate expiry checks and data retention (step
 * payloads after 30 days, form submissions after 90, old runs, events, quota
 * counters and cron history). Safe to call every 15 minutes: it no-ops unless
 * the last successful run was more than 20 hours ago. `?force=1` overrides.
 */
export async function POST(request: NextRequest) {
  if (!isCronAuthorised(request.headers)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid cron credentials." } }, { status: 401 });
  }

  const now = new Date();
  const force = request.nextUrl.searchParams.get("force") === "1";
  if (!force) {
    const last = await prisma.cronRun.findFirst({
      where: { job: "maintenance", error: null, finishedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    if (last && now.getTime() - last.startedAt.getTime() < MIN_INTERVAL_MS) {
      return NextResponse.json({ skipped: true, lastRunAt: last.startedAt });
    }
  }

  const deadline = now.getTime() + BUDGET_MS;
  const run = await prisma.cronRun.create({ data: { job: "maintenance", startedAt: now }, select: { id: true } });
  try {
    const tls = await runTlsChecks(now.getTime() + BUDGET_MS / 2, now);
    const retention = await runRetention(deadline, now);
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), processed: tls.checked, succeeded: tls.alerts },
    });
    log.info("maintenance complete", { ...retention, tlsChecked: tls.checked, tlsAlerts: tls.alerts });
    return NextResponse.json({ tls, retention });
  } catch (error) {
    log.error("maintenance failed", { error: error as Error });
    await prisma.cronRun
      .update({ where: { id: run.id }, data: { finishedAt: new Date(), error: "CRON_FAILURE" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: { code: "CRON_FAILURE", message: "The scheduler could not complete this batch." } },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
