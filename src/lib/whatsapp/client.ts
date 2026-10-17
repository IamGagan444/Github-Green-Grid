import "server-only";

import { ConfigurationError, getWhatsAppConfig, type WhatsAppConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { linkMessageText, whatsAppChatLink } from "@/lib/whatsapp/bot";
import { whatsAppError, type WhatsAppErrorBody } from "@/lib/whatsapp/errors";

/**
 * Minimal WhatsApp Cloud API client. The access token is only ever sent in the
 * Authorization header — never in a URL, a log line or a thrown error.
 */

const GRAPH_HOST = "https://graph.facebook.com";
const REQUEST_TIMEOUT_MS = 15_000;

export function isWhatsAppConfigured(): boolean {
  try {
    getWhatsAppConfig();
    return true;
  } catch (error) {
    if (error instanceof ConfigurationError) return false;
    throw error;
  }
}

function config(): WhatsAppConfig {
  try {
    return getWhatsAppConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) throw new AppError("CONFIGURATION_MISSING", error.message);
    throw error;
  }
}

async function postMessage(payload: Record<string, unknown>): Promise<string> {
  const { accessToken, phoneNumberId, graphVersion } = config();
  let response: Response;
  try {
    response = await fetch(`${GRAPH_HOST}/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("CHANNEL_DELIVERY_FAILED", "whatsapp network error or timeout");
  }

  const body = (await response.json().catch(() => ({}))) as WhatsAppErrorBody & { messages?: Array<{ id?: string }> };
  if (response.ok) return body.messages?.[0]?.id ?? "sent";
  throw whatsAppError(response.status, body);
}

/**
 * Business-initiated message through the approved template. Outside the
 * 24-hour customer-service window this is the only kind WhatsApp accepts, and
 * the one Meta bills for.
 */
export async function sendWhatsAppTemplate(input: { to: string; parameters: [string, string] }): Promise<string> {
  const { templateName, templateLanguage } = config();
  return postMessage({
    to: input.to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: templateLanguage },
      components: [{ type: "body", parameters: input.parameters.map((text) => ({ type: "text", text })) }],
    },
  });
}

/** Free-form reply. Only valid within 24 hours of the user's last message to us (free to send). */
export async function sendWhatsAppText(input: { to: string; text: string }): Promise<string> {
  return postMessage({
    to: input.to.replace(/^\+/, ""),
    type: "text",
    text: { body: input.text.slice(0, 4_096), preview_url: false },
  });
}

/** Opens WhatsApp with the business number and the link code already typed. */
export function whatsAppLinkUrl(code: string): string {
  return whatsAppChatLink(config().businessNumber, linkMessageText(code));
}
