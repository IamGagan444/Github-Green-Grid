import type { InstagramEventType, StepStatus } from "@/generated/prisma/enums";
import { AppError, toAppError } from "@/lib/errors";
import {
  buildFirstMessage,
  buildFollowGateMessage,
  buildLinkMessage,
  parseFollowGatePayload,
  pickPublicReply,
  type DmContent,
} from "@/lib/instagram/message";
import type { OutgoingMessage } from "@/lib/instagram/types";

/**
 * Executes one stored Instagram webhook event against its automation.
 *
 * Every step is recorded before the next starts, so a retry resumes where the
 * previous attempt stopped and never sends the same DM twice. The DM runs
 * before the public reply: a missed public reply is cosmetic, a missed DM is
 * the whole point.
 */

export const MAX_ATTEMPTS = 5;
export const LEASE_MS = 60_000;
/** Meta's private-reply window is 7 days; leave margin for clock skew. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 - 10 * 60 * 1000;

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export function retryDelayMs(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1)] ?? 60_000;
}

export const NOT_FOLLOWING_TEXT =
  "Looks like you're not following yet 👀 Follow the account, then tap the button again.";

export interface AutomationContent extends DmContent {
  id: string;
  active: boolean;
  publicReplyEnabled: boolean;
  publicReplies: string[];
}

export interface ClaimedEvent {
  id: string;
  type: InstagramEventType;
  /** Comment id for COMMENT, message id otherwise. */
  sourceId: string;
  senderIgsid: string;
  text: string | null;
  occurredAt: Date;
  attempt: number;
  publicReplyStatus: StepStatus;
  dmStatus: StepStatus;
  linkStatus: StepStatus;
  automation: AutomationContent | null;
}

export interface InstagramEventStore {
  /** Takes the lease on a runnable event; null when finished or held elsewhere. */
  claim(eventId: string, leaseMs: number): Promise<ClaimedEvent | null>;
  saveStep(
    eventId: string,
    patch: Partial<Pick<ClaimedEvent, "publicReplyStatus" | "dmStatus" | "linkStatus">> & {
      publicReplyId?: string | null;
      dmMessageId?: string | null;
    },
  ): Promise<void>;
  finish(eventId: string, status: "SUCCESS" | "FAILED" | "SKIPPED", error?: AppError): Promise<void>;
  scheduleRetry(eventId: string, at: Date, error: AppError): Promise<void>;
  /** Marks the follow-gated origin event's link as delivered. */
  markLinkDelivered(originEventId: string): Promise<void>;
  incrementSent(automationId: string): Promise<void>;
}

export interface InstagramPort {
  privateReply(commentId: string, message: OutgoingMessage): Promise<{ messageId: string | null }>;
  sendDirect(igsid: string, message: OutgoingMessage): Promise<{ messageId: string | null }>;
  replyToComment(commentId: string, text: string): Promise<{ id: string }>;
  followsBusiness(igsid: string): Promise<boolean>;
}

export interface InstagramEngineDeps {
  store: InstagramEventStore;
  port: InstagramPort;
  /** Click-tracking redirect for an origin event, or null when the automation has no link. */
  trackedUrl(originEventId: string, linkUrl: string | null): string | null;
  now?: () => Date;
  random?: () => number;
}

export type EventOutcome = "SUCCESS" | "FAILED" | "SKIPPED" | "RETRY" | "BUSY";

export async function processInstagramEvent(deps: InstagramEngineDeps, eventId: string): Promise<EventOutcome> {
  const event = await deps.store.claim(eventId, LEASE_MS);
  if (!event) return "BUSY";

  const automation = event.automation;
  if (!automation || !automation.active) {
    await deps.store.finish(event.id, "SKIPPED", new AppError("AUTOMATION_NOT_ACTIVE", "automation paused or deleted"));
    return "SKIPPED";
  }

  try {
    if (event.type === "POSTBACK") return await handlePostback(deps, event, automation);
    if (event.type === "COMMENT") return await handleComment(deps, event, automation);
    return await handleMessage(deps, event, automation);
  } catch (error) {
    const appError = toAppError(error, "instagram-engine");
    if (appError.retryable && event.attempt < MAX_ATTEMPTS) {
      const now = (deps.now ?? (() => new Date()))();
      const delay = Math.max(appError.retryAfterMs ?? 0, retryDelayMs(event.attempt));
      await deps.store.scheduleRetry(event.id, new Date(now.getTime() + delay), appError);
      return "RETRY";
    }
    await deps.store.finish(event.id, "FAILED", appError);
    return "FAILED";
  }
}

async function handleComment(
  deps: InstagramEngineDeps,
  event: ClaimedEvent,
  automation: AutomationContent,
): Promise<EventOutcome> {
  const now = (deps.now ?? (() => new Date()))();

  if (event.dmStatus === "PENDING") {
    if (now.getTime() - event.occurredAt.getTime() > PRIVATE_REPLY_WINDOW_MS) {
      await deps.store.saveStep(event.id, { dmStatus: "SKIPPED", linkStatus: "SKIPPED", publicReplyStatus: "SKIPPED" });
      await deps.store.finish(
        event.id,
        "SKIPPED",
        new AppError("INSTAGRAM_REQUEST_REJECTED", "comment older than the 7-day private reply window"),
      );
      return "SKIPPED";
    }

    const tracked = deps.trackedUrl(event.id, automation.linkUrl);
    const first = buildFirstMessage(automation, event.id, tracked);
    let sent: { messageId: string | null };
    try {
      sent = await deps.port.privateReply(event.sourceId, first);
    } catch (error) {
      // If Instagram refuses a button template as a private reply, fall back to
      // plain text with the link inline (no follow-gate is possible then).
      if (!(error instanceof AppError) || error.code !== "INSTAGRAM_REQUEST_REJECTED" || !("attachment" in first)) {
        throw error;
      }
      const text = tracked ? `${automation.dmMessage}\n\n${tracked}` : automation.dmMessage;
      sent = await deps.port.privateReply(event.sourceId, { text });
      await deps.store.saveStep(event.id, { dmStatus: "SUCCESS", linkStatus: "SUCCESS", dmMessageId: sent.messageId });
      await deps.store.incrementSent(automation.id);
      return finishComment(deps, event, automation);
    }

    await deps.store.saveStep(event.id, {
      dmStatus: "SUCCESS",
      // With the gate on, the link goes out later from the postback.
      linkStatus: automation.followGateEnabled ? "PENDING" : automation.linkUrl ? "SUCCESS" : "SKIPPED",
      dmMessageId: sent.messageId,
    });
    await deps.store.incrementSent(automation.id);
  }

  return finishComment(deps, event, automation);
}

async function finishComment(
  deps: InstagramEngineDeps,
  event: ClaimedEvent,
  automation: AutomationContent,
): Promise<EventOutcome> {
  if (event.publicReplyStatus === "PENDING") {
    const reply = automation.publicReplyEnabled ? pickPublicReply(automation.publicReplies, deps.random) : null;
    if (!reply) {
      await deps.store.saveStep(event.id, { publicReplyStatus: "SKIPPED" });
    } else {
      try {
        const posted = await deps.port.replyToComment(event.sourceId, reply);
        await deps.store.saveStep(event.id, { publicReplyStatus: "SUCCESS", publicReplyId: posted.id });
      } catch (error) {
        // A permanently failed public reply does not fail the event: the DM went out.
        if (error instanceof AppError && error.retryable) throw error;
        await deps.store.saveStep(event.id, { publicReplyStatus: "FAILED" });
      }
    }
  }

  await deps.store.finish(event.id, "SUCCESS");
  return "SUCCESS";
}

/** DM keyword, story reply and story mention: the 24h window is open, send directly. */
async function handleMessage(
  deps: InstagramEngineDeps,
  event: ClaimedEvent,
  automation: AutomationContent,
): Promise<EventOutcome> {
  if (event.dmStatus === "PENDING") {
    const tracked = deps.trackedUrl(event.id, automation.linkUrl);
    const sent = await deps.port.sendDirect(event.senderIgsid, buildFirstMessage(automation, event.id, tracked));
    await deps.store.saveStep(event.id, {
      dmStatus: "SUCCESS",
      publicReplyStatus: "SKIPPED",
      linkStatus: automation.followGateEnabled ? "PENDING" : automation.linkUrl ? "SUCCESS" : "SKIPPED",
      dmMessageId: sent.messageId,
    });
    await deps.store.incrementSent(automation.id);
  }
  await deps.store.finish(event.id, "SUCCESS");
  return "SUCCESS";
}

/** Follow-gate button tap: check the follow, then send the link or re-prompt. */
async function handlePostback(
  deps: InstagramEngineDeps,
  event: ClaimedEvent,
  automation: AutomationContent,
): Promise<EventOutcome> {
  const originId = event.text ? parseFollowGatePayload(event.text) : null;
  if (!originId) {
    await deps.store.finish(event.id, "SKIPPED");
    return "SKIPPED";
  }

  if (event.dmStatus === "PENDING") {
    const follows = await deps.port.followsBusiness(event.senderIgsid);
    const message = follows
      ? buildLinkMessage(automation, deps.trackedUrl(originId, automation.linkUrl))
      : buildFollowGateMessage({ ...automation, followGateMessage: NOT_FOLLOWING_TEXT }, originId);
    const sent = await deps.port.sendDirect(event.senderIgsid, message);
    await deps.store.saveStep(event.id, {
      dmStatus: "SUCCESS",
      publicReplyStatus: "SKIPPED",
      linkStatus: follows ? "SUCCESS" : "SKIPPED",
      dmMessageId: sent.messageId,
    });
    if (follows) await deps.store.markLinkDelivered(originId);
  }

  await deps.store.finish(event.id, "SUCCESS");
  return "SUCCESS";
}
