import "server-only";

import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { AuthorizationError, type Actor } from "@/lib/rbac";
import {
  MAX_INSTAGRAM_AUTOMATIONS_PER_ACCOUNT,
  type InstagramAutomationInput,
} from "@/validators/instagram";
import { recordAudit } from "@/services/audit-service";

const automationSelect = {
  id: true,
  userId: true,
  integrationId: true,
  name: true,
  status: true,
  trigger: true,
  mediaIds: true,
  keywords: true,
  matchMode: true,
  publicReplyEnabled: true,
  publicReplies: true,
  dmMessage: true,
  linkUrl: true,
  linkButtonLabel: true,
  followGateEnabled: true,
  followGateMessage: true,
  followButtonLabel: true,
  triggeredCount: true,
  sentCount: true,
  clickCount: true,
  createdAt: true,
  updatedAt: true,
  integration: { select: { username: true, status: true } },
} as const;

export async function listInstagramAutomations(userId: string) {
  return prisma.instagramAutomation.findMany({
    where: { userId },
    select: automationSelect,
    orderBy: { createdAt: "desc" },
  });
}

export type InstagramAutomationView = Awaited<ReturnType<typeof listInstagramAutomations>>[number];

/** Owner-only. Anything else is NOT_FOUND so ids cannot be probed. */
export async function getInstagramAutomation(actor: Actor, id: string): Promise<InstagramAutomationView> {
  const automation = await prisma.instagramAutomation.findFirst({ where: { id, userId: actor.userId }, select: automationSelect });
  if (!automation) throw new AuthorizationError("NOT_FOUND");
  return automation;
}

async function assertOwnIntegration(userId: string, integrationId: string) {
  const integration = await prisma.instagramIntegration.findFirst({
    where: { id: integrationId, userId },
    select: { id: true, status: true },
  });
  if (!integration) throw new AppError("INSTAGRAM_NOT_CONNECTED", "integration not owned by user");
  return integration;
}

function toData(input: InstagramAutomationInput) {
  return {
    integrationId: input.integrationId,
    name: input.name,
    trigger: input.trigger,
    mediaIds: input.trigger === "COMMENT" ? input.mediaIds : [],
    keywords: input.matchMode === "ANY" ? [] : input.keywords,
    matchMode: input.matchMode,
    publicReplyEnabled: input.publicReplyEnabled,
    publicReplies: input.publicReplies,
    dmMessage: input.dmMessage,
    linkUrl: input.linkUrl,
    linkButtonLabel: input.linkButtonLabel,
    followGateEnabled: input.followGateEnabled,
    followGateMessage: input.followGateMessage,
    followButtonLabel: input.followButtonLabel,
  };
}

export async function createInstagramAutomation(actor: Actor, input: InstagramAutomationInput): Promise<string> {
  await assertOwnIntegration(actor.userId, input.integrationId);
  const count = await prisma.instagramAutomation.count({ where: { integrationId: input.integrationId } });
  if (count >= MAX_INSTAGRAM_AUTOMATIONS_PER_ACCOUNT) {
    throw new AppError("INSTAGRAM_REQUEST_REJECTED", "automation limit reached", {
      userMessage: `Each Instagram account can have at most ${MAX_INSTAGRAM_AUTOMATIONS_PER_ACCOUNT} automations.`,
    });
  }

  const automation = await prisma.instagramAutomation.create({
    data: { ...toData(input), userId: actor.userId },
    select: { id: true },
  });
  await recordAudit({
    actorUserId: actor.userId,
    action: "INSTAGRAM_AUTOMATION_CREATED",
    targetType: "InstagramAutomation",
    targetId: automation.id,
    metadata: { name: input.name, trigger: input.trigger },
  });
  return automation.id;
}

export async function updateInstagramAutomation(actor: Actor, id: string, input: InstagramAutomationInput): Promise<void> {
  await getInstagramAutomation(actor, id);
  await assertOwnIntegration(actor.userId, input.integrationId);
  await prisma.instagramAutomation.update({ where: { id }, data: toData(input) });
  await recordAudit({
    actorUserId: actor.userId,
    action: "INSTAGRAM_AUTOMATION_UPDATED",
    targetType: "InstagramAutomation",
    targetId: id,
    metadata: { name: input.name, trigger: input.trigger },
  });
}

export async function setInstagramAutomationPaused(actor: Actor, id: string, paused: boolean): Promise<void> {
  const automation = await getInstagramAutomation(actor, id);
  if (automation.status === "DISABLED") throw new AppError("AUTOMATION_NOT_ACTIVE", "automation disabled by admin");
  await prisma.instagramAutomation.update({ where: { id }, data: { status: paused ? "PAUSED" : "ACTIVE" } });
  await recordAudit({
    actorUserId: actor.userId,
    action: paused ? "INSTAGRAM_AUTOMATION_PAUSED" : "INSTAGRAM_AUTOMATION_RESUMED",
    targetType: "InstagramAutomation",
    targetId: id,
  });
}

export async function deleteInstagramAutomation(actor: Actor, id: string): Promise<void> {
  const automation = await getInstagramAutomation(actor, id);
  await prisma.instagramAutomation.delete({ where: { id } });
  await recordAudit({
    actorUserId: actor.userId,
    action: "INSTAGRAM_AUTOMATION_DELETED",
    targetType: "InstagramAutomation",
    targetId: id,
    metadata: { name: automation.name },
  });
}

export async function listInstagramEvents(actor: Actor, automationId: string, take = 50) {
  await getInstagramAutomation(actor, automationId);
  return prisma.instagramEvent.findMany({
    where: { automationId },
    select: {
      id: true,
      type: true,
      senderUsername: true,
      text: true,
      status: true,
      dmStatus: true,
      publicReplyStatus: true,
      linkStatus: true,
      errorMessage: true,
      attempt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}
