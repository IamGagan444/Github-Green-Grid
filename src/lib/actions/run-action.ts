import "server-only";

import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import type { ActionState } from "@/lib/actions/action-state";
import { ApiError } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { GitHubApiError } from "@/lib/github/errors";
import { createLogger } from "@/lib/logging/logger";
import { AuthorizationError } from "@/lib/rbac";

const log = createLogger("action");

/**
 * Server Actions are public POST endpoints, so each one authenticates,
 * authorizes, rate-limits and validates exactly like the API routes. Next.js
 * rejects actions whose Origin does not match the host (CSRF), and session
 * cookies are SameSite=Lax.
 *
 * This wrapper turns thrown errors into user-safe messages; stack traces and
 * provider payloads stay in the server log. `redirect()`/`notFound()` are
 * re-thrown so Next.js can handle them.
 */
export async function runAction(context: string, operation: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await operation();
    return { status: "success", message, at: Date.now() };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error", message: userMessageFor(error, context), at: Date.now() };
  }
}

function userMessageFor(error: unknown, context: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof AuthorizationError) return error.message;
  if (error instanceof AppError) {
    log.warn(context, { code: error.code, detail: error.message });
    return error.userMessage;
  }
  if (error instanceof GitHubApiError) {
    log.warn(context, { code: error.code, status: error.status, detail: error.message });
    return error.userMessage;
  }
  if (error instanceof ZodError) return "The submitted data is invalid.";
  log.error(context, { error: error instanceof Error ? error : String(error) });
  return "Something went wrong. Please try again.";
}

/** FormData as a plain object for schema parsing (repeated keys become arrays). */
export function formFields(formData: FormData): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string" || key.startsWith("$ACTION")) continue;
    const existing = fields[key];
    fields[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return fields;
}
