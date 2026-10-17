import { after, NextResponse, type NextRequest } from "next/server";

import { clientIp, readBodyText } from "@/lib/api";
import { getAppUrl } from "@/lib/env";
import { createLogger } from "@/lib/logging/logger";
import { rateLimit, rateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
import { submitForm } from "@/services/form-service";
import "@/services/workflow-handlers";
import { processRuns } from "@/services/workflow-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const log = createLogger("form-submit");

const MAX_BODY_BYTES = 64 * 1024;

const REJECT_MESSAGES = {
  not_found: "This form isn't accepting responses.",
  origin: "This form can't be submitted from this website.",
  token: "Please reload the page and try again.",
  expired: "This page has been open too long. Reload it and try again.",
} as const;

function corsHeaders(origin: string | null): Record<string, string> {
  // Only reflected for JSON callers; the form-service origin check is the real gate.
  return origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } : {};
}

function parseBody(contentType: string, raw: string): Record<string, unknown> | null {
  try {
    if (contentType.includes("application/json")) {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    }
    const params = new URLSearchParams(raw);
    const out: Record<string, unknown> = {};
    for (const [key, value] of params) out[key] = key in out ? out[key] : value;
    return out;
  } catch {
    return null;
  }
}

/** Preflight for JSON posts from the owner's own site. */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

/**
 * Public submission endpoint. Browsers posting a plain HTML form get a
 * redirect back to the hosted form page; JSON callers get JSON (with field
 * errors). Writing to the Sheet, emailing and alerting happen after the
 * response, through the workflow engine.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await context.params;
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type") ?? "";
  const wantsJson = contentType.includes("application/json");
  const pageUrl = `${getAppUrl()}/f/${encodeURIComponent(publicId)}`;
  const respond = (status: number, body: Record<string, unknown>, redirectQuery: string) =>
    wantsJson
      ? NextResponse.json(body, { status, headers: corsHeaders(origin) })
      : NextResponse.redirect(`${pageUrl}?${redirectQuery}`, 303);

  const ip = clientIp(request);
  for (const [key, options] of [
    [`form-submit:ip:${ip}`, RATE_LIMITS.formSubmitIp],
    [`form-submit:form:${publicId}`, RATE_LIMITS.formSubmitForm],
  ] as const) {
    const limit = await rateLimit(key, options);
    if (!limit.success) {
      return wantsJson
        ? NextResponse.json({ ok: false, message: "Too many responses. Try again in a minute." }, { status: 429, headers: { ...rateLimitHeaders(limit), ...corsHeaders(origin) } })
        : NextResponse.redirect(`${pageUrl}?error=busy`, 303);
    }
  }

  const raw = await readBodyText(request, MAX_BODY_BYTES).catch(() => null);
  const body = raw === null ? null : parseBody(contentType, raw);
  if (!body) return respond(400, { ok: false, message: "That response couldn't be read." }, "error=invalid");

  let outcome;
  try {
    outcome = await submitForm(publicId, body, { ip, origin });
  } catch (error) {
    log.error("form submission failed", { error: error as Error });
    return respond(500, { ok: false, message: "Something went wrong. Please try again." }, "error=server");
  }

  if (outcome.status === "rejected") {
    return respond(outcome.reason === "not_found" ? 404 : 403, { ok: false, message: REJECT_MESSAGES[outcome.reason] }, `error=${outcome.reason}`);
  }
  if (outcome.status === "invalid") {
    return respond(422, { ok: false, message: "Please fix the highlighted fields.", errors: outcome.errors }, "error=invalid");
  }

  const run = outcome.run;
  if (run) {
    after(async () => {
      try {
        await processRuns([run], { deadline: Date.now() + 20_000 });
      } catch (error) {
        log.error("form run failed", { error: error as Error });
      }
    });
  }
  return respond(200, { ok: true, message: outcome.thankYouMessage }, "sent=1");
}
