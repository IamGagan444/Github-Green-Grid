import "server-only";

import type { ChannelKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret, fingerprint } from "@/lib/encryption";
import { getAppUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  CHANNEL_KIND_LABELS,
  channelConfigSchemas,
  channelIdentity,
  type ChannelConfig,
} from "@/lib/hub/channel-config";
import { hubMessage, md, type HubMessage } from "@/lib/hub/message";
import { renderDiscord, renderEmail, renderSlack, renderTelegram } from "@/lib/hub/render";
import { localDayKey } from "@/lib/automation/schedule";
import { createLogger } from "@/lib/logging/logger";
import { waitForTokens } from "@/lib/rate-limit";
import type { Actor } from "@/lib/rbac";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { recordAudit } from "@/services/audit-service";
import { createGooglePort, getGoogleIntegration } from "@/services/google-service";
import { reserve } from "@/services/quota-service";
import { checkChannelAccess, createSlackPort } from "@/services/slack-service";
import { createRunIfAbsent } from "@/services/workflow-store";

const log = createLogger("channel-service");

const DISCORD_TIMEOUT_MS = 15_000;
/** How long a worker waits for a send slot before deferring to a retry. */
const MAX_RATE_WAIT_MS = 5_000;

export interface ChannelRow {
  id: string;
  userId: string;
  kind: ChannelKind;
  label: string;
  configEncrypted: string;
  verified: boolean;
}

function readConfig<K extends ChannelKind>(kind: K, ciphertext: string): ChannelConfig<K> {
  try {
    return channelConfigSchemas[kind].parse(JSON.parse(decryptSecret(ciphertext))) as ChannelConfig<K>;
  } catch {
    throw new AppError("CHANNEL_UNAVAILABLE", `stored ${kind} channel config unreadable`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery
// ─────────────────────────────────────────────────────────────────────────────

async function deliverTelegram(channel: ChannelRow, message: HubMessage): Promise<string> {
  const config = readConfig("TELEGRAM", channel.configEncrypted);
  const perChat =
    config.chatType === "private"
      ? { ratePerSecond: 1, burst: 3 }
      : // Groups and channels: about 20 messages per minute.
        { ratePerSecond: 1 / 3, burst: 3 };
  const slot = await waitForTokens(
    [
      { key: "tg:global", options: { ratePerSecond: 25, burst: 25 } },
      { key: `tg:chat:${config.chatId}`, options: perChat },
    ],
    MAX_RATE_WAIT_MS,
  );
  if (!slot.ok) throw new AppError("CHANNEL_RATE_LIMITED", "telegram send slot unavailable", { retryAfterMs: slot.retryAfterMs });

  const reservation = await reserve("TELEGRAM_MESSAGES", channel.userId, 1);
  try {
    const rendered = renderTelegram(message);
    const sent = await sendTelegramMessage({ chatId: config.chatId, html: rendered.text, replyMarkup: rendered.replyMarkup });
    return String(sent.messageId);
  } catch (error) {
    await reservation.release();
    throw error;
  }
}

async function deliverDiscord(channel: ChannelRow, message: HubMessage): Promise<string> {
  const { webhookUrl } = readConfig("DISCORD_WEBHOOK", channel.configEncrypted);
  // Discord allows about 5 requests per 2 seconds per webhook.
  const slot = await waitForTokens(
    [{ key: `discord:${fingerprint(webhookUrl).slice(0, 32)}`, options: { ratePerSecond: 2, burst: 5 } }],
    MAX_RATE_WAIT_MS,
  );
  if (!slot.ok) throw new AppError("CHANNEL_RATE_LIMITED", "discord send slot unavailable", { retryAfterMs: slot.retryAfterMs });

  let response: Response;
  try {
    response = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(renderDiscord(message)),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("CHANNEL_DELIVERY_FAILED", "discord webhook network error or timeout");
  }

  if (response.ok) {
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return body.id ?? "sent";
  }
  if (response.status === 429) {
    const body = (await response.json().catch(() => ({}))) as { retry_after?: number };
    throw new AppError("CHANNEL_RATE_LIMITED", "discord 429", { retryAfterMs: Math.ceil((body.retry_after ?? 2) * 1000) });
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new AppError("CHANNEL_UNAVAILABLE", `discord webhook ${response.status}`);
  }
  if (response.status >= 500) throw new AppError("CHANNEL_DELIVERY_FAILED", `discord ${response.status}`);
  throw new AppError("INTERNAL", `discord rejected payload ${response.status}`);
}

async function deliverSlack(channel: ChannelRow, message: HubMessage): Promise<string> {
  const config = readConfig("SLACK", channel.configEncrypted);
  const rendered = renderSlack(message);
  const posted = await createSlackPort(channel.userId, config.slackIntegrationId, "BOT").post({
    channel: config.channelId,
    text: rendered.text,
    blocks: rendered.blocks,
    metadata: { event_type: "greengrid_notification", event_payload: { channel: channel.id } },
  });
  return posted.ts;
}

async function deliverEmail(channel: ChannelRow, message: HubMessage): Promise<string> {
  const { to } = readConfig("EMAIL", channel.configEncrypted);
  const reservation = await reserve("EMAILS", channel.userId, 1);
  try {
    const rendered = renderEmail(message);
    const sent = await createGooglePort(channel.userId).sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fromName: "GreenGrid",
    });
    return sent.messageId;
  } catch (error) {
    await reservation.release();
    throw error;
  }
}

/** Sends one message to one channel. Throws AppErrors classified for the workflow engine. */
export async function deliverToChannel(channel: ChannelRow, message: HubMessage): Promise<{ externalId: string }> {
  let externalId: string;
  switch (channel.kind) {
    case "TELEGRAM":
      externalId = await deliverTelegram(channel, message);
      break;
    case "DISCORD_WEBHOOK":
      externalId = await deliverDiscord(channel, message);
      break;
    case "SLACK":
      externalId = await deliverSlack(channel, message);
      break;
    case "EMAIL":
      externalId = await deliverEmail(channel, message);
      break;
  }
  await prisma.notificationChannel.updateMany({
    where: { id: channel.id },
    data: { lastDeliveredAt: new Date(), lastError: null },
  });
  return { externalId };
}

/** Error codes meaning the destination itself is gone, not that one message failed. */
const BROKEN_CHANNEL_CODES = new Set([
  "CHANNEL_UNAVAILABLE",
  "GOOGLE_TOKEN_REVOKED",
  "GOOGLE_NOT_CONNECTED",
  "GOOGLE_PERMISSION_DENIED",
  "SLACK_TOKEN_REVOKED",
  "SLACK_NOT_CONNECTED",
  "SLACK_CHANNEL_UNAVAILABLE",
  "SLACK_PERMISSION_DENIED",
]);

export function isBrokenChannelError(error: AppError): boolean {
  return BROKEN_CHANNEL_CODES.has(error.code);
}

/**
 * Marks a channel unverified so rules stop targeting it, and tells the user
 * once a day through their other working channels.
 */
export async function markChannelBroken(channelId: string, error: AppError, now = new Date()): Promise<void> {
  const channel = await prisma.notificationChannel.findUnique({
    where: { id: channelId },
    select: { id: true, userId: true, kind: true, label: true, verified: true, user: { select: { defaultTimezone: true } } },
  });
  if (!channel) return;
  await prisma.notificationChannel.update({
    where: { id: channel.id },
    data: { verified: false, lastError: error.userMessage.slice(0, 300) },
  });
  if (!channel.verified) return;

  const others = await prisma.notificationChannel.findMany({
    where: { userId: channel.userId, verified: true, id: { not: channel.id } },
    select: { id: true },
    take: 3,
  });
  if (others.length === 0) return;

  const day = localDayKey(now, channel.user.defaultTimezone);
  const key = `channel-broken:${channel.id}:${day}`;
  const message = hubMessage({
    title: `${CHANNEL_KIND_LABELS[channel.kind]} channel “${channel.label}” stopped working`,
    body: `${md.text(error.userMessage, 300)}\nNotifications routed only to it are paused until you reconnect it.`,
    buttons: [{ label: "Open notification settings", url: `${getAppUrl()}/notifications` }],
    severity: "warning",
  });
  await createRunIfAbsent({
    userId: channel.userId,
    kind: "NOTIFY",
    idempotencyKey: key,
    title: message.title,
    subjectType: "NotificationChannel",
    subjectId: channel.id,
    input: { message },
    steps: others.map((other) => ({
      key: `notify:${other.id}`,
      idempotencyKey: `${key}:${other.id}`,
      payload: { channelId: other.id },
    })),
  });
  log.warn("notification channel marked broken", { channelId, code: error.code });
}

// ─────────────────────────────────────────────────────────────────────────────
// Management
// ─────────────────────────────────────────────────────────────────────────────

export interface ChannelView {
  id: string;
  kind: ChannelKind;
  label: string;
  verified: boolean;
  lastError: string | null;
  lastDeliveredAt: Date | null;
  createdAt: Date;
}

export async function listChannels(userId: string): Promise<ChannelView[]> {
  return prisma.notificationChannel.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, label: true, verified: true, lastError: true, lastDeliveredAt: true, createdAt: true },
  });
}

/** Creates or refreshes a channel. Same destination twice = same row (unique on the fingerprint). */
export async function upsertChannel<K extends ChannelKind>(
  userId: string,
  kind: K,
  label: string,
  config: ChannelConfig<K>,
  verified: boolean,
): Promise<string> {
  const parsed = channelConfigSchemas[kind].parse(config);
  const externalRef = fingerprint(channelIdentity(kind, parsed));
  const data = {
    label: label.slice(0, 80),
    configEncrypted: encryptSecret(JSON.stringify(parsed)),
    verified,
    verifiedAt: verified ? new Date() : null,
    lastError: null,
  };
  const row = await prisma.notificationChannel.upsert({
    where: { userId_kind_externalRef: { userId, kind, externalRef } },
    create: { ...data, userId, kind, externalRef },
    update: data,
    select: { id: true },
  });
  return row.id;
}

const TEST_MESSAGE = hubMessage({
  title: "GreenGrid is connected",
  body: "This channel will receive the notifications you route to it.",
  severity: "success",
});

async function ownedChannel(actor: Actor, channelId: string): Promise<ChannelRow> {
  const channel = await prisma.notificationChannel.findFirst({
    where: { id: channelId, userId: actor.userId },
    select: { id: true, userId: true, kind: true, label: true, configEncrypted: true, verified: true },
  });
  if (!channel) throw new AppError("CHANNEL_UNAVAILABLE", "channel not found for user", { userMessage: "That channel was not found." });
  return channel;
}

/** Delivery test used when adding a channel: the destination must accept a real message. */
async function verifyBySending(userId: string, kind: ChannelKind, label: string, configEncrypted: string): Promise<void> {
  await deliverToChannel({ id: "unsaved", userId, kind, label, configEncrypted, verified: false }, TEST_MESSAGE);
}

export async function addDiscordChannel(actor: Actor, input: { label: string; webhookUrl: string }): Promise<string> {
  const config = channelConfigSchemas.DISCORD_WEBHOOK.parse({ webhookUrl: input.webhookUrl });
  await verifyBySending(actor.userId, "DISCORD_WEBHOOK", input.label, encryptSecret(JSON.stringify(config)));
  const id = await upsertChannel(actor.userId, "DISCORD_WEBHOOK", input.label, config, true);
  await recordAudit({ actorUserId: actor.userId, action: "CHANNEL_CREATED", targetType: "NotificationChannel", targetId: id, metadata: { kind: "DISCORD_WEBHOOK" } });
  return id;
}

export async function addSlackChannel(actor: Actor, input: { slackIntegrationId: string; channelId: string }): Promise<string> {
  const channel = await checkChannelAccess(actor.userId, input.slackIntegrationId, input.channelId, "BOT");
  const config = channelConfigSchemas.SLACK.parse({
    slackIntegrationId: input.slackIntegrationId,
    channelId: input.channelId,
    channelName: channel.name,
  });
  const id = await upsertChannel(actor.userId, "SLACK", `#${channel.name}`, config, true);
  await recordAudit({ actorUserId: actor.userId, action: "CHANNEL_CREATED", targetType: "NotificationChannel", targetId: id, metadata: { kind: "SLACK" } });
  return id;
}

export async function addEmailChannel(actor: Actor, input: { label: string; to: string }): Promise<string> {
  const google = await getGoogleIntegration(actor.userId);
  if (!google.canSendEmail) throw new AppError("GOOGLE_NOT_CONNECTED", "gmail.send not granted");
  const config = channelConfigSchemas.EMAIL.parse({ to: input.to });
  await verifyBySending(actor.userId, "EMAIL", input.label, encryptSecret(JSON.stringify(config)));
  const id = await upsertChannel(actor.userId, "EMAIL", input.label || config.to, config, true);
  await recordAudit({ actorUserId: actor.userId, action: "CHANNEL_CREATED", targetType: "NotificationChannel", targetId: id, metadata: { kind: "EMAIL" } });
  return id;
}

/** Sends a test message; a success re-verifies a channel that had broken. */
export async function testChannel(actor: Actor, channelId: string): Promise<void> {
  const channel = await ownedChannel(actor, channelId);
  try {
    await deliverToChannel(channel, TEST_MESSAGE);
  } catch (error) {
    if (error instanceof AppError) {
      await prisma.notificationChannel.update({
        where: { id: channel.id },
        data: { lastError: error.userMessage.slice(0, 300), ...(isBrokenChannelError(error) ? { verified: false } : {}) },
      });
    }
    throw error;
  }
  await prisma.notificationChannel.update({
    where: { id: channel.id },
    data: { verified: true, verifiedAt: new Date(), lastError: null },
  });
}

export async function deleteChannel(actor: Actor, channelId: string): Promise<void> {
  const channel = await ownedChannel(actor, channelId);
  await prisma.notificationChannel.delete({ where: { id: channel.id } });
  await recordAudit({
    actorUserId: actor.userId,
    action: channel.kind === "TELEGRAM" ? "TELEGRAM_DISCONNECTED" : "CHANNEL_DELETED",
    targetType: "NotificationChannel",
    targetId: channel.id,
    metadata: { kind: channel.kind },
  });
}
