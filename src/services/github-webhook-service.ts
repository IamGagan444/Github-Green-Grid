import "server-only";

import { prisma } from "@/lib/db";
import { getGitHubClient } from "@/lib/github/github-client";
import { normaliseGitHubEvent, parseInstallationEvent } from "@/lib/github/webhook";
import { createLogger } from "@/lib/logging/logger";
import { ingestEvent } from "@/services/notification-service";

const log = createLogger("github-webhook");

export type GitHubDeliveryOutcome =
  | { kind: "ignored" }
  | { kind: "installation" }
  | { kind: "unrouted" }
  | { kind: "event"; eventId: string; created: boolean };

/**
 * Handles one verified delivery. Installation events maintain the
 * installation → user map; repository events become hub events for the user
 * who owns the installation. The X-GitHub-Delivery id is the idempotency key,
 * so GitHub's redeliveries are absorbed.
 */
export async function handleGitHubDelivery(input: {
  eventName: string;
  deliveryId: string;
  payload: unknown;
}): Promise<GitHubDeliveryOutcome> {
  const installation = parseInstallationEvent(input.eventName, input.payload);
  if (installation) {
    await applyInstallationChange(installation);
    return { kind: "installation" };
  }

  const event = normaliseGitHubEvent(input.eventName, input.payload);
  if (!event) return { kind: "ignored" };

  const owner = await prisma.gitHubInstallation.findUnique({
    where: { installationId: event.installationId },
    select: { userId: true, suspendedAt: true, user: { select: { status: true } } },
  });
  if (!owner?.userId || owner.suspendedAt || owner.user?.status !== "ACTIVE") return { kind: "unrouted" };

  const stored = await ingestEvent({
    userId: owner.userId,
    source: "GITHUB",
    type: event.type,
    idempotencyKey: `gh:${input.deliveryId}`,
    attrs: event.attrs,
    message: event.message,
  });
  return { kind: "event", eventId: stored.id, created: stored.created };
}

async function applyInstallationChange(change: NonNullable<ReturnType<typeof parseInstallationEvent>>): Promise<void> {
  if (change.kind === "delete") {
    await prisma.gitHubInstallation.deleteMany({ where: { installationId: change.installationId } });
    return;
  }

  // The person who installed the App, if they have connected GitHub in GreenGrid.
  const integration = await prisma.gitHubIntegration.findUnique({
    where: { githubUserId: change.senderGitHubId },
    select: { userId: true },
  });
  const existing = await prisma.gitHubInstallation.findUnique({
    where: { installationId: change.installationId },
    select: { userId: true },
  });

  const data = {
    accountId: change.accountId,
    accountLogin: change.accountLogin,
    accountType: change.accountType,
    repositorySelection: change.repositorySelection,
    ...(change.suspended === null ? {} : { suspendedAt: change.suspended ? new Date() : null }),
  };
  await prisma.gitHubInstallation.upsert({
    where: { installationId: change.installationId },
    // An installation keeps its first owner; later events by teammates do not move it.
    create: { ...data, installationId: change.installationId, userId: integration?.userId ?? null },
    update: { ...data, ...(existing?.userId ? {} : { userId: integration?.userId ?? null }) },
  });
}

/**
 * Links installations the user can access that have no owner yet (installed
 * before the webhook existed, or before the user connected GitHub).
 */
export async function syncGitHubInstallations(userId: string): Promise<number> {
  let installations: Array<{ id: number; account: { id: number; login: string; type?: string } | null; repository_selection?: string }>;
  try {
    const client = await getGitHubClient(userId);
    const response = await client.request("GET /user/installations", { per_page: 100 });
    installations = response.data.installations as typeof installations;
  } catch (error) {
    log.warn("listing github installations failed", { userId, error: error as Error });
    return 0;
  }

  let linked = 0;
  for (const installation of installations) {
    const installationId = String(installation.id);
    const data = {
      accountId: String(installation.account?.id ?? ""),
      accountLogin: installation.account?.login ?? "unknown",
      accountType: installation.account?.type ?? "User",
      repositorySelection: installation.repository_selection ?? null,
    };
    const existing = await prisma.gitHubInstallation.findUnique({ where: { installationId }, select: { userId: true } });
    if (existing?.userId && existing.userId !== userId) continue;
    await prisma.gitHubInstallation.upsert({
      where: { installationId },
      create: { ...data, installationId, userId },
      update: { ...data, userId },
    });
    linked += 1;
  }
  return linked;
}

export async function listGitHubInstallations(userId: string) {
  return prisma.gitHubInstallation.findMany({
    where: { userId },
    select: { id: true, accountLogin: true, accountType: true, repositorySelection: true, suspendedAt: true },
    orderBy: { createdAt: "asc" },
  });
}
