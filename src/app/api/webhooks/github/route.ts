import { after, NextResponse, type NextRequest } from "next/server";

import { clientIp, readBodyText } from "@/lib/api";
import { ConfigurationError, getGitHubWebhookSecret } from "@/lib/env";
import { verifyGitHubSignature } from "@/lib/github/webhook";
import { createLogger } from "@/lib/logging/logger";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
import { handleGitHubDelivery } from "@/services/github-webhook-service";
import { processEventNow } from "@/services/notification-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const log = createLogger("github-webhook");

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const AFTER_BUDGET_MS = 40_000;

/**
 * GitHub App webhook (App settings → Webhook URL). The signature is checked
 * over the raw body before anything is parsed. The event is stored and
 * acknowledged within GitHub's 10-second limit; delivery happens after the
 * response, and the hub cron sweeps anything unfinished.
 */
export async function POST(request: NextRequest) {
  const limit = await rateLimit(`github-webhook:${clientIp(request)}`, RATE_LIMITS.githubWebhook);
  if (!limit.success) return NextResponse.json({ ok: false }, { status: 429, headers: rateLimitHeaders(limit) });

  let secret: string;
  try {
    secret = getGitHubWebhookSecret();
  } catch (error) {
    if (error instanceof ConfigurationError) return NextResponse.json({ ok: false }, { status: 503 });
    throw error;
  }

  const rawBody = await readBodyText(request, MAX_BODY_BYTES).catch(() => null);
  if (rawBody === null) return NextResponse.json({ ok: false }, { status: 413 });
  if (!verifyGitHubSignature({ secret, signature: request.headers.get("x-hub-signature-256"), rawBody })) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const eventName = request.headers.get("x-github-event") ?? "";
  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  if (eventName === "ping") return NextResponse.json({ ok: true });
  if (!/^[A-Za-z0-9-]{8,64}$/.test(deliveryId)) return NextResponse.json({ ok: false }, { status: 400 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  let outcome;
  try {
    outcome = await handleGitHubDelivery({ eventName, deliveryId, payload });
  } catch (error) {
    // 500 makes the delivery visible as failed in GitHub, where it can be redelivered.
    log.error("github delivery failed", { eventName, error: error as Error });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (outcome.kind === "event" && outcome.created) {
    const eventId = outcome.eventId;
    after(async () => {
      try {
        await processEventNow(eventId, Date.now() + AFTER_BUDGET_MS);
      } catch (error) {
        log.error("github event processing failed", { eventId, error: error as Error });
      }
    });
  }
  return NextResponse.json({ ok: true, outcome: outcome.kind });
}
