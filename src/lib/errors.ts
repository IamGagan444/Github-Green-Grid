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
  | "INSTAGRAM_OAUTH_FAILED"
  | "INSTAGRAM_NOT_CONNECTED"
  | "INSTAGRAM_TOKEN_REVOKED"
  | "INSTAGRAM_PERMISSION_DENIED"
  | "INSTAGRAM_RATE_LIMITED"
  | "INSTAGRAM_UNAVAILABLE"
  | "INSTAGRAM_REQUEST_REJECTED"
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
  | "CHANNEL_UNAVAILABLE"
  | "CHANNEL_RATE_LIMITED"
  | "CHANNEL_DELIVERY_FAILED"
  | "QUOTA_EXHAUSTED"
  | "GOOGLE_OAUTH_FAILED"
  | "GOOGLE_NOT_CONNECTED"
  | "GOOGLE_TOKEN_REVOKED"
  | "GOOGLE_PERMISSION_DENIED"
  | "GOOGLE_UNAVAILABLE"
  | "LINKEDIN_OAUTH_FAILED"
  | "LINKEDIN_NOT_CONNECTED"
  | "LINKEDIN_TOKEN_REVOKED"
  | "LINKEDIN_RATE_LIMITED"
  | "LINKEDIN_UNAVAILABLE"
  | "URL_NOT_ALLOWED"
  | "FETCH_FAILED"
  | "STEP_OUTCOME_UNKNOWN"
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
  INSTAGRAM_OAUTH_FAILED: {
    message: "Instagram could not complete the connection. Please try again.",
    retryable: false,
    httpStatus: 502,
  },
  INSTAGRAM_NOT_CONNECTED: {
    message: "Connect an Instagram professional account in Settings first.",
    retryable: false,
    httpStatus: 409,
  },
  INSTAGRAM_TOKEN_REVOKED: {
    message: "Your Instagram connection expired or was revoked. Reconnect Instagram in Settings.",
    retryable: false,
    httpStatus: 409,
  },
  INSTAGRAM_PERMISSION_DENIED: {
    message: "Instagram denied the request. Reconnect Instagram and approve all requested permissions.",
    retryable: false,
    httpStatus: 403,
  },
  INSTAGRAM_RATE_LIMITED: {
    message: "Instagram rate limit reached. Messages will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  INSTAGRAM_UNAVAILABLE: {
    message: "Instagram is temporarily unavailable. Messages will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  INSTAGRAM_REQUEST_REJECTED: {
    message: "Instagram rejected the message (for example, the reply window has closed or the user blocked messages).",
    retryable: false,
    httpStatus: 422,
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
  LINKEDIN_OAUTH_FAILED: {
    message: "LinkedIn could not complete the connection. Please try again.",
    retryable: false,
    httpStatus: 502,
  },
  LINKEDIN_NOT_CONNECTED: {
    message: "Connect LinkedIn in Settings → Connections first.",
    retryable: false,
    httpStatus: 409,
  },
  LINKEDIN_TOKEN_REVOKED: {
    message: "Your LinkedIn connection expired or was revoked. Reconnect LinkedIn in Settings → Connections.",
    retryable: false,
    httpStatus: 409,
  },
  LINKEDIN_RATE_LIMITED: {
    message: "LinkedIn asked us to slow down. The post will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  LINKEDIN_UNAVAILABLE: {
    message: "LinkedIn is temporarily unavailable. The post will be retried automatically.",
    retryable: true,
    httpStatus: 503,
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
  CHANNEL_UNAVAILABLE: {
    message: "The notification channel no longer accepts messages (the bot was blocked or the webhook was deleted). Reconnect it.",
    retryable: false,
    httpStatus: 409,
  },
  CHANNEL_RATE_LIMITED: {
    message: "The messaging service asked us to slow down. Delivery will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  CHANNEL_DELIVERY_FAILED: {
    message: "The messaging service is temporarily unavailable. Delivery will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  QUOTA_EXHAUSTED: {
    message: "Today's free usage limit is reached. This will continue automatically when it resets.",
    retryable: true,
    httpStatus: 429,
  },
  GOOGLE_OAUTH_FAILED: {
    message: "Google could not complete the connection. Please try again.",
    retryable: false,
    httpStatus: 502,
  },
  GOOGLE_NOT_CONNECTED: {
    message: "Connect Google in Settings → Connections first.",
    retryable: false,
    httpStatus: 409,
  },
  GOOGLE_TOKEN_REVOKED: {
    message: "Your Google connection expired or was revoked. Reconnect Google in Settings → Connections.",
    retryable: false,
    httpStatus: 409,
  },
  GOOGLE_PERMISSION_DENIED: {
    message: "Google denied the request. Reconnect Google and approve Sheets and Gmail access.",
    retryable: false,
    httpStatus: 403,
  },
  GOOGLE_UNAVAILABLE: {
    message: "Google is temporarily unavailable. This will be retried automatically.",
    retryable: true,
    httpStatus: 503,
  },
  URL_NOT_ALLOWED: {
    message: "That URL is not allowed. Use a public http(s) address.",
    retryable: false,
    httpStatus: 422,
  },
  FETCH_FAILED: {
    message: "The address could not be reached. It will be tried again later.",
    retryable: true,
    httpStatus: 502,
  },
  STEP_OUTCOME_UNKNOWN: {
    message: "We could not confirm whether this was published, so it was not retried. Check the destination before posting again.",
    retryable: false,
    httpStatus: 409,
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

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SPEC, value);
}

/** Rebuilds an AppError from a stored code (unknown codes become INTERNAL). */
export function appErrorFromCode(code: string | null | undefined): AppError {
  return new AppError(isAppErrorCode(code) ? code : "INTERNAL", `stored error ${code ?? "none"}`);
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
