/**
 * Typed application errors.
 *
 * Every failure the automation pipeline can hit maps to one `AppErrorCode`.
 * Each code carries a user-facing message that is safe to render (no provider
 * payloads, no identifiers from third parties) and a retry classification that
 * drives the retry policy:
 *
 *   - `retryable: true`  — transient (rate limits, 5xx, timeouts). Retried with
 *                          exponential backoff, then by the scheduler.
 *   - `retryable: false` — permanent (revoked tokens, missing permission,
 *                          invalid configuration). Never retried automatically.
 *
 * The `internalMessage` (Error#message) is for server logs only.
 */

export type AppErrorCode =
  | "GITHUB_OAUTH_FAILED"
  | "GITHUB_NOT_CONNECTED"
  | "GITHUB_TOKEN_REVOKED"
  | "GITHUB_PERMISSION_DENIED"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_UNAVAILABLE"
  | "REPOSITORY_UNAVAILABLE"
  | "SLACK_OAUTH_FAILED"
  | "SLACK_NOT_CONNECTED"
  | "SLACK_TOKEN_REVOKED"
  | "SLACK_CHANNEL_UNAVAILABLE"
  | "SLACK_PERMISSION_DENIED"
  | "SLACK_RATE_LIMITED"
  | "SLACK_UNAVAILABLE"
  | "SLACK_USER_POSTING_UNAVAILABLE"
  | "AI_PROVIDER_FAILED"
  | "AI_INVALID_OUTPUT"
  | "AI_NOT_CONFIGURED"
  | "DATABASE_FAILURE"
  | "CRON_FAILURE"
  | "DUPLICATE_EXECUTION"
  | "EXECUTION_IN_PROGRESS"
  | "TIMEZONE_INVALID"
  | "AUTOMATION_NOT_ACTIVE"
  | "NO_COMMITS"
  | "CONFIGURATION_MISSING"
  | "INTERNAL";

interface CodeSpec {
  message: string;
  retryable: boolean;
  httpStatus: number;
}

const SPEC: Record<AppErrorCode, CodeSpec> = {
  GITHUB_OAUTH_FAILED: {
    message: "GitHub could not complete the connection. Please try again.",
    retryable: false,
    httpStatus: 502,
  },
  GITHUB_NOT_CONNECTED: {
    message: "Connect GitHub in Settings before running this automation.",
    retryable: false,
    httpStatus: 409,
  },
  GITHUB_TOKEN_REVOKED: {
    message: "Your GitHub connection has expired or was revoked. Reconnect GitHub in Settings.",
    retryable: false,
    httpStatus: 409,
  },
  GITHUB_PERMISSION_DENIED: {
    message: "GitHub denied access. Check that the GitHub App can access this repository.",
    retryable: false,
    httpStatus: 403,
  },
  GITHUB_RATE_LIMITED: {
    message: "GitHub rate limit reached. The run will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  GITHUB_UNAVAILABLE: {
    message: "GitHub is temporarily unavailable. The run will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  REPOSITORY_UNAVAILABLE: {
    message: "A selected repository or branch is no longer available on GitHub.",
    retryable: false,
    httpStatus: 404,
  },
  SLACK_OAUTH_FAILED: {
    message: "Slack could not complete the connection. Please try again.",
    retryable: false,
    httpStatus: 502,
  },
  SLACK_NOT_CONNECTED: {
    message: "Connect Slack in Settings before running this automation.",
    retryable: false,
    httpStatus: 409,
  },
  SLACK_TOKEN_REVOKED: {
    message: "Your Slack connection was revoked or the app was uninstalled. Reconnect Slack in Settings.",
    retryable: false,
    httpStatus: 409,
  },
  SLACK_CHANNEL_UNAVAILABLE: {
    message: "The Slack channel is unavailable. It may be archived, deleted, or the app was removed from it.",
    retryable: false,
    httpStatus: 404,
  },
  SLACK_PERMISSION_DENIED: {
    message: "Slack denied the request. Reconnect Slack to grant the required permissions, or invite the app to the channel.",
    retryable: false,
    httpStatus: 403,
  },
  SLACK_RATE_LIMITED: {
    message: "Slack rate limit reached. The run will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  SLACK_UNAVAILABLE: {
    message: "Slack is temporarily unavailable. The run will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  SLACK_USER_POSTING_UNAVAILABLE: {
    message: "\"Post as me\" needs Slack user permissions. Reconnect Slack and approve posting as yourself, or switch to bot posting.",
    retryable: false,
    httpStatus: 409,
  },
  AI_PROVIDER_FAILED: {
    message: "The AI summary service is unavailable. The run will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  AI_INVALID_OUTPUT: {
    message: "The AI returned a summary that failed validation, so nothing was posted.",
    retryable: true,
    httpStatus: 502,
  },
  AI_NOT_CONFIGURED: {
    message: "AI summaries are not configured on this server. Contact an administrator.",
    retryable: false,
    httpStatus: 503,
  },
  DATABASE_FAILURE: {
    message: "A database error occurred. Please try again.",
    retryable: true,
    httpStatus: 503,
  },
  CRON_FAILURE: {
    message: "The scheduler could not complete this batch.",
    retryable: true,
    httpStatus: 500,
  },
  DUPLICATE_EXECUTION: {
    message: "This automation has already posted its update for this date.",
    retryable: false,
    httpStatus: 409,
  },
  EXECUTION_IN_PROGRESS: {
    message: "This automation is already running for this date.",
    retryable: false,
    httpStatus: 409,
  },
  TIMEZONE_INVALID: {
    message: "The automation's timezone is not recognised. Edit the automation and choose a valid timezone.",
    retryable: false,
    httpStatus: 422,
  },
  AUTOMATION_NOT_ACTIVE: {
    message: "This automation is paused or disabled.",
    retryable: false,
    httpStatus: 409,
  },
  NO_COMMITS: {
    message: "No commits by you were found in the selected repositories for this date.",
    retryable: false,
    httpStatus: 200,
  },
  CONFIGURATION_MISSING: {
    message: "This feature is not configured on the server. Contact an administrator.",
    retryable: false,
    httpStatus: 503,
  },
  INTERNAL: {
    message: "Something went wrong. Please try again.",
    retryable: false,
    httpStatus: 500,
  },
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  /** Provider-suggested wait (e.g. Slack `Retry-After`), in milliseconds. */
  readonly retryAfterMs: number | null;

  constructor(
    code: AppErrorCode,
    internalMessage?: string,
    options: { userMessage?: string; retryAfterMs?: number | null; cause?: unknown } = {},
  ) {
    super(internalMessage ?? code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.userMessage = options.userMessage ?? SPEC[code].message;
    this.retryable = SPEC[code].retryable;
    this.httpStatus = SPEC[code].httpStatus;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function userMessageFor(code: AppErrorCode): string {
  return SPEC[code].message;
}

const PRISMA_CONNECTIVITY_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

/** Normalises anything thrown into an AppError without leaking its message. */
export function toAppError(error: unknown, context = "unknown"): AppError {
  if (error instanceof AppError) return error;

  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && PRISMA_CONNECTIVITY_CODES.has(code)) {
    return new AppError("DATABASE_FAILURE", `${context}: database connectivity error ${code}`);
  }

  const name = error instanceof Error ? error.name : typeof error;
  return new AppError("INTERNAL", `${context}: unexpected ${name}`, { cause: error });
}
