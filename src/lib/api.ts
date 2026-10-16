import { NextResponse } from "next/server";
import { ZodError } from "zod";
import "server-only";

import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { GitHubApiError } from "@/lib/github/errors";
import { createLogger } from "@/lib/logging/logger";
import { rateLimit, type RateLimitOptions } from "@/lib/rate-limit";
import {
  assertPermission,
  AuthorizationError,
  type Permission,
} from "@/lib/rbac";

const log = createLogger("api");

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "CONFLICT"
  | "GITHUB_ERROR"
  | "PROVIDER_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  CONFLICT: 409,
  GITHUB_ERROR: 502,
  PROVIDER_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export interface ApiErrorBody {
  error: { code: ApiErrorCode | string; message: string; details?: unknown };
}

/** Thrown by route handlers; converted to a safe JSON body by `handleApiError`. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  /** Sent as `Retry-After` on 429 responses. */
  readonly retryAfterSeconds?: number;

  constructor(code: ApiErrorCode, message: string, details?: unknown, options: { retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function jsonError(
  code: ApiErrorCode | string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status },
  );
}

/**
 * Converts any thrown value into a user-safe response.
 * Stack traces, provider payloads and unexpected messages stay server-side.
 */
export function handleApiError(error: unknown, context: string): NextResponse<ApiErrorBody> {
  if (error instanceof ApiError) {
    if (error.code === "INTERNAL_ERROR") log.error(context, { message: error.message });
    const response = jsonError(error.code, error.message, STATUS_BY_CODE[error.code], error.details);
    if (error.retryAfterSeconds) response.headers.set("Retry-After", String(error.retryAfterSeconds));
    return response;
  }

  if (error instanceof AuthorizationError) {
    const status = error.code === "UNAUTHORIZED" ? 401 : error.code === "NOT_FOUND" ? 404 : 403;
    return jsonError(error.code, error.message, status);
  }

  if (error instanceof AppError) {
    log.warn(context, { code: error.code, detail: error.message });
    return jsonError(error.code, error.userMessage, error.httpStatus);
  }

  if (error instanceof GitHubApiError) {
    log.warn(context, { code: error.code, status: error.status, detail: error.message });
    return jsonError("GITHUB_ERROR", error.userMessage, STATUS_BY_CODE.GITHUB_ERROR);
  }

  if (error instanceof ZodError) {
    return jsonError("VALIDATION_ERROR", "The submitted data is invalid.", 422, {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  log.error(context, { error: error instanceof Error ? error : String(error) });
  return jsonError("INTERNAL_ERROR", "Something went wrong. Please try again.", 500);
}

/** Route-handler guard. Throws for anonymous or disabled callers. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("UNAUTHORIZED");
  return user;
}

/** Authentication + status + role permission in one call. */
export async function authorize(permission: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  assertPermission(user, permission);
  return user as SessionUser;
}

/**
 * CSRF defence for cookie-authenticated mutations. Session cookies are
 * SameSite=Lax (so cross-site POSTs carry no cookie), and additionally every
 * mutating request must come from our own origin.
 */
export function assertSameOrigin(request: Request): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const expected = new URL(getAppUrl()).origin;
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin !== expected) throw new ApiError("FORBIDDEN", "Cross-origin request rejected.");
    return;
  }

  // Some clients omit Origin on same-origin requests; fall back to Referer.
  const referer = request.headers.get("referer");
  if (!referer || new URL(referer).origin !== expected) {
    throw new ApiError("FORBIDDEN", "Cross-origin request rejected.");
  }
}

export async function enforceRateLimit(key: string, options: RateLimitOptions): Promise<void> {
  const result = await rateLimit(key, options);
  if (!result.success) {
    throw new ApiError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", undefined, {
      retryAfterSeconds: Math.max(1, result.retryAfterSeconds ?? 1),
    });
  }
}

/** Largest JSON body any API route accepts. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/** Reads a request body as text, refusing anything over `maxBytes` without buffering all of it. */
export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "The request body is too large.");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError("PAYLOAD_TOO_LARGE", "The request body is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function readJson<T>(
  request: Request,
  schema: { parse: (value: unknown) => T },
  options: { maxBytes?: number } = {},
): Promise<T> {
  const text = await readBodyText(request, options.maxBytes ?? MAX_JSON_BODY_BYTES);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  return schema.parse(body);
}

/**
 * The caller's IP for rate limiting. On Vercel, `x-real-ip` is set by the
 * platform from the connecting address and cannot be supplied by the client,
 * unlike the left-most `x-forwarded-for` entry, which a client can forge.
 */
export function clientIp(request: Request): string {
  return clientIpFromHeaders(request.headers);
}

export function clientIpFromHeaders(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  // Elsewhere, the right-most entry was added by the nearest trusted proxy.
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded?.at(-1) || "unknown";
}
