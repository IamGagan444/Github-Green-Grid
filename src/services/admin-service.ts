import "server-only";

import { revokeAllSessions } from "@/lib/auth/maintenance";
import { prisma } from "@/lib/db";
import { getConfigurationStatus } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertPermission, AuthorizationError, type Actor } from "@/lib/rbac";
import type { Prisma } from "@/generated/prisma/client";
import type { UserStatus } from "@/generated/prisma/enums";
import { recordAudit } from "@/services/audit-service";

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getAdminOverview(actor: Actor, now: Date = new Date()) {
  assertPermission(actor, "admin:access");
  const since = startOfUtcDay(now);

  const [
    totalUsers,
    activeUsers,
    disabledUsers,
    totalAutomations,
    activeAutomations,
    pausedAutomations,
    executionsToday,
    successfulToday,
    failedToday,
    githubConnected,
    slackConnected,
  ] = await prisma.$transaction([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { status: "DISABLED" } }),
    prisma.automation.count(),
    prisma.automation.count({ where: { status: "ACTIVE" } }),
    prisma.automation.count({ where: { status: "PAUSED" } }),
    prisma.execution.count({ where: { startedAt: { gte: since } } }),
    prisma.execution.count({ where: { startedAt: { gte: since }, status: "SUCCESS" } }),
    prisma.execution.count({ where: { startedAt: { gte: since }, status: "FAILED" } }),
    prisma.gitHubIntegration.count({ where: { status: "CONNECTED" } }),
    prisma.slackIntegration.count({ where: { status: "CONNECTED" } }),
  ]);

  return {
    totalUsers,
    activeUsers,
    disabledUsers,
    totalAutomations,
    activeAutomations,
    pausedAutomations,
    executionsToday,
    successfulToday,
    failedToday,
    githubConnected,
    slackConnected,
  };
}

export async function listUsers(
  actor: Actor,
  query: { search?: string; status?: UserStatus; page: number; pageSize: number },
) {
  assertPermission(actor, "user:read:all");
  const where: Prisma.UserWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { automations: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return { items, total };
}

/** User detail for admins. Integration rows are selected field-by-field: no tokens. */
export async function getUserDetail(actor: Actor, userId: string) {
  assertPermission(actor, "user:read:all");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      githubIntegration: {
        select: { username: true, status: true, connectedAt: true, disconnectedAt: true },
      },
      slackIntegrations: {
        select: { id: true, teamName: true, status: true, connectedAt: true, disconnectedAt: true },
      },
      _count: { select: { automations: true, executions: true } },
    },
  });
  if (!user) throw new AuthorizationError("NOT_FOUND");
  return user;
}

/**
 * Enables or disables a user. Disabling revokes every session immediately and
 * stops their automations from being scheduled (the scheduler requires an
 * ACTIVE owner). An admin cannot disable themselves.
 */
export async function setUserStatus(actor: Actor, userId: string, status: UserStatus) {
  assertPermission(actor, "user:manage");
  if (userId === actor.userId) {
    throw new AppError("INTERNAL", "admin attempted to change own status", {
      userMessage: "You cannot change the status of your own account.",
    });
  }

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
  if (!target) throw new AuthorizationError("NOT_FOUND");
  if (target.status === status) return;

  await prisma.user.update({ where: { id: userId }, data: { status } });
  if (status === "DISABLED") await revokeAllSessions(userId);

  await recordAudit({
    actorUserId: actor.userId,
    action: status === "DISABLED" ? "USER_DISABLED" : "USER_ENABLED",
    targetType: "User",
    targetId: userId,
  });
}

export async function listIntegrations(actor: Actor) {
  assertPermission(actor, "integration:read:all");
  const [github, slack] = await Promise.all([
    prisma.gitHubIntegration.findMany({
      orderBy: { connectedAt: "desc" },
      take: 200,
      select: {
        id: true,
        username: true,
        status: true,
        connectedAt: true,
        disconnectedAt: true,
        tokenExpiresAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.slackIntegration.findMany({
      orderBy: { connectedAt: "desc" },
      take: 200,
      select: {
        id: true,
        teamName: true,
        teamId: true,
        status: true,
        botScopes: true,
        userScopes: true,
        connectedAt: true,
        disconnectedAt: true,
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { automations: true } },
      },
    }),
  ]);
  return { github, slack };
}

export async function getSystemHealth(actor: Actor) {
  assertPermission(actor, "system:read");

  const started = Date.now();
  let databaseOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    databaseOk = false;
  }
  const databaseLatencyMs = Date.now() - started;

  const [lastCronRuns, runningExecutions, stuckExecutions, pendingRetries] = await Promise.all([
    prisma.cronRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
    prisma.execution.count({ where: { status: "RUNNING" } }),
    prisma.execution.count({ where: { status: "RUNNING", leaseExpiresAt: { lt: new Date() } } }),
    prisma.execution.count({ where: { status: "FAILED", nextRetryAt: { not: null } } }),
  ]);

  return {
    databaseOk,
    databaseLatencyMs,
    configuration: getConfigurationStatus(),
    lastCronRuns,
    runningExecutions,
    stuckExecutions,
    pendingRetries,
    runtime: { node: process.version, environment: process.env.NODE_ENV ?? "development" },
  };
}
