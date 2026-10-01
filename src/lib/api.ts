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

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
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
    return jsonError(error.code, error.message, STATUS_BY_CODE[error.code], error.details);
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
    throw new ApiError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  }
}

export async function readJson<T>(
  request: Request,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  return schema.parse(body);
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
