import { NextResponse } from "next/server";
import { ZodError } from "zod";
import "server-only";

import { getSessionUser, type SessionUser } from "@/lib/session";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "GITHUB_ERROR"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  GITHUB_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
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
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status: STATUS_BY_CODE[code] },
  );
}

/**
 * Converts any thrown value into a user-safe response.
 * Stack traces and unexpected messages stay server-side.
 */
export function handleApiError(error: unknown, context: string): NextResponse<ApiErrorBody> {
  if (error instanceof ApiError) {
    if (error.code === "INTERNAL_ERROR") {
      console.error(`[${context}]`, error.message);
    }
    return jsonError(error.code, error.message, error.details);
  }

  if (error instanceof ZodError) {
    return jsonError("VALIDATION_ERROR", "The submitted data is invalid.", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  console.error(`[${context}]`, error);
  return jsonError("INTERNAL_ERROR", "Something went wrong. Please try again.");
}

/** Route-handler guard. Throws `ApiError("UNAUTHORIZED")` for anonymous callers. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new ApiError("UNAUTHORIZED", "You need to sign in to continue.");
  }
  return user;
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
