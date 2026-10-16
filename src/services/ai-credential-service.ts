import "server-only";

import { z } from "zod";

import { createOpenAiCompatibleCompletion, type AiEndpoint } from "@/lib/ai/openai-compatible";
import { noAiKeyError, resolveAiSource, type AiPort } from "@/lib/ai/port";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/encryption";
import { getPlatformAiConfig, isProduction } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertPublicUrl, SafeFetchError, safeFetch } from "@/lib/net/safe-fetch";
import type { Actor } from "@/lib/rbac";
import { recordAudit } from "@/services/audit-service";

const AI_TIMEOUT_MS = 60_000;

export const aiCredentialInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  baseUrl: z
    .string()
    .trim()
    .url()
    .max(300)
    .refine((value) => value.startsWith("https://"), "Use an https:// base URL")
    .transform((value) => value.replace(/\/+$/, "")),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(8).max(500),
});

/** User endpoints go through the SSRF guard; the response body is capped. */
async function guardedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    const response = await safeFetch(url, {
      method: "POST",
      headers: init.headers as Record<string, string>,
      body: init.body as string,
      httpsOnly: true,
      timeoutMs: AI_TIMEOUT_MS,
      maxBytes: 1024 * 1024,
      maxRedirects: 0,
    });
    return new Response(new Uint8Array(response.body), { status: response.status, headers: response.headers });
  } catch (error) {
    if (error instanceof SafeFetchError && (error.code === "BLOCKED" || error.code === "INVALID_URL")) {
      throw new AppError("URL_NOT_ALLOWED", `ai base url refused: ${error.code}`);
    }
    throw error;
  }
}

function completeWith(endpoint: AiEndpoint, untrusted: boolean): AiPort {
  return {
    async complete(request) {
      return createOpenAiCompatibleCompletion(
        endpoint,
        [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        {
          maxTokens: request.maxTokens ?? 1024,
          json: request.json,
          ...(untrusted ? { fetchImpl: guardedFetch, rejectBadRequests: true } : {}),
        },
      );
    },
  };
}

async function loadUserEndpoint(userId: string): Promise<AiEndpoint | null> {
  const row = await prisma.aiCredential.findUnique({ where: { userId } });
  if (!row) return null;
  try {
    return { baseUrl: row.baseUrl, model: row.model, apiKey: decryptSecret(row.keyEncrypted) };
  } catch {
    return null;
  }
}

/**
 * The AI port for a user's automations: their own key, the platform key only
 * outside production, otherwise every call fails with AI_NOT_CONFIGURED (which
 * callers turn into "send without the AI summary").
 */
export async function getAiPortForUser(userId: string): Promise<AiPort> {
  const source = resolveAiSource({
    userEndpoint: await loadUserEndpoint(userId),
    platformEndpoint: getPlatformAiConfig(),
    production: isProduction(),
  });
  if (source.kind === "none") {
    return {
      complete: async () => {
        throw noAiKeyError();
      },
    };
  }
  return completeWith(source.endpoint, source.kind === "user");
}

export interface AiCredentialView {
  label: string;
  baseUrl: string;
  model: string;
  keyHint: string;
  lastVerifiedAt: Date | null;
  lastError: string | null;
}

export async function getAiCredential(userId: string): Promise<AiCredentialView | null> {
  const row = await prisma.aiCredential.findUnique({ where: { userId } });
  if (!row) return null;
  let keyHint = "••••";
  try {
    keyHint = `••••${decryptSecret(row.keyEncrypted).slice(-4)}`;
  } catch {
    // Unreadable key: shown as masked only.
  }
  return { label: row.label, baseUrl: row.baseUrl, model: row.model, keyHint, lastVerifiedAt: row.lastVerifiedAt, lastError: row.lastError };
}

/** Validates the endpoint with a tiny real request before storing the (encrypted) key. */
export async function saveAiCredential(actor: Actor, raw: unknown): Promise<void> {
  const input = aiCredentialInputSchema.parse(raw);
  try {
    await assertPublicUrl(input.baseUrl, { httpsOnly: true });
  } catch {
    throw new AppError("URL_NOT_ALLOWED", "ai base url not public");
  }

  const endpoint = { baseUrl: input.baseUrl, model: input.model, apiKey: input.apiKey };
  try {
    await completeWith(endpoint, true).complete({ system: "Reply with the single word OK.", user: "ping", maxTokens: 5 });
  } catch (error) {
    if (error instanceof AppError && error.code === "AI_NOT_CONFIGURED") {
      throw new AppError("AI_NOT_CONFIGURED", "ai key test failed", {
        userMessage: "The provider rejected this key or model. Check the API key, base URL and model name.",
      });
    }
    throw error;
  }

  const data = {
    label: input.label,
    baseUrl: input.baseUrl,
    model: input.model,
    keyEncrypted: encryptSecret(input.apiKey),
    lastVerifiedAt: new Date(),
    lastError: null,
  };
  await prisma.aiCredential.upsert({ where: { userId: actor.userId }, create: { ...data, userId: actor.userId }, update: data });
  await recordAudit({
    actorUserId: actor.userId,
    action: "AI_KEY_SAVED",
    targetType: "AiCredential",
    metadata: { label: input.label, baseUrl: input.baseUrl, model: input.model },
  });
}

export async function deleteAiCredential(actor: Actor): Promise<void> {
  const { count } = await prisma.aiCredential.deleteMany({ where: { userId: actor.userId } });
  if (count > 0) await recordAudit({ actorUserId: actor.userId, action: "AI_KEY_DELETED", targetType: "AiCredential" });
}
