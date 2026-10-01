import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { clientIp } from "@/lib/api";
import { createLogger } from "@/lib/logging/logger";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { verifySlackSignature } from "@/lib/slack/signature";
import { markWorkspaceRevoked } from "@/services/slack-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("slack-events");

const MAX_BODY_BYTES = 64 * 1024;

const envelopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url_verification"), challenge: z.string().max(200) }),
  z.object({
    type: z.literal("event_callback"),
    team_id: z.string().max(40),
    event: z
      .object({
        type: z.string().max(60),
        tokens: z.object({ oauth: z.array(z.string()).optional(), bot: z.array(z.string()).optional() }).optional(),
      })
      .passthrough(),
  }),
]);

/**
 * Slack Events API endpoint (optional — configure it in the Slack app to have
 * uninstalls and token revocations reflected immediately). Every request's
 * signature is verified against SLACK_SIGNING_SECRET before it is parsed.
 */
export async function POST(request: NextRequest) {
  const limit = await rateLimit(`slack-events:${clientIp(request)}`, RATE_LIMITS.webhook);
  if (!limit.success) return NextResponse.json({ ok: false }, { status: 429 });

  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!signingSecret) return NextResponse.json({ ok: false }, { status: 503 });

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });

  const valid = verifySlackSignature({
    signingSecret,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    rawBody,
  });
  if (!valid) return NextResponse.json({ ok: false }, { status: 401 });

  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(JSON.parse(rawBody));
  } catch {
    // Unknown envelope types are acknowledged so Slack does not retry them.
    return NextResponse.json({ ok: true });
  }

  if (envelope.type === "url_verification") {
    return NextResponse.json({ challenge: envelope.challenge });
  }

  if (envelope.event.type === "app_uninstalled") {
    const count = await markWorkspaceRevoked(envelope.team_id, "all");
    log.info("slack app uninstalled", { teamId: envelope.team_id, integrations: count });
  } else if (envelope.event.type === "tokens_revoked") {
    const botRevoked = (envelope.event.tokens?.bot?.length ?? 0) > 0;
    const userIds = envelope.event.tokens?.oauth ?? [];
    const count = botRevoked
      ? await markWorkspaceRevoked(envelope.team_id, "all")
      : await markWorkspaceRevoked(envelope.team_id, "user", userIds);
    log.info("slack tokens revoked", { teamId: envelope.team_id, integrations: count });
  }

  return NextResponse.json({ ok: true });
}
