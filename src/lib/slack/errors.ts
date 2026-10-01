import { AppError } from "@/lib/errors";

/**
 * Maps a Slack Web API `error` string (from an `ok: false` response) to an
 * AppError. Slack error strings are stable identifiers and contain no secrets,
 * but they are still kept out of user-facing messages.
 */

const REVOKED = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "org_login_required",
  "team_access_not_granted",
  "ekm_access_denied",
  "app_uninstalled",
]);

const CHANNEL_UNAVAILABLE = new Set([
  "channel_not_found",
  "is_archived",
  "channel_is_archived",
  "not_in_channel",
  "thread_not_found",
  "message_not_found",
]);

const PERMISSION = new Set([
  "missing_scope",
  "not_allowed_token_type",
  "restricted_action",
  "restricted_action_read_only_channel",
  "restricted_action_thread_only_channel",
  "restricted_action_non_threadable_channel",
  "access_denied",
  "no_permission",
  "cant_join",
  "method_not_supported_for_channel_type",
]);

const TRANSIENT = new Set([
  "internal_error",
  "fatal_error",
  "service_unavailable",
  "request_timeout",
  "timeout",
  "ratelimited",
  "rate_limited",
]);

/** Errors caused by our own request shape — permanent, and a bug if seen. */
const INVALID_REQUEST = new Set([
  "invalid_arguments",
  "invalid_arg_name",
  "invalid_array_arg",
  "invalid_charset",
  "invalid_form_data",
  "invalid_post_type",
  "missing_post_type",
  "invalid_blocks",
  "invalid_blocks_format",
  "invalid_metadata_format",
  "invalid_metadata_schema",
  "msg_too_long",
  "no_text",
  "too_many_attachments",
]);

export function slackErrorToAppError(
  slackError: string,
  method: string,
  retryAfterMs: number | null = null,
): AppError {
  const internal = `slack ${method} failed: ${slackError}`;

  if (slackError === "ratelimited" || slackError === "rate_limited") {
    return new AppError("SLACK_RATE_LIMITED", internal, { retryAfterMs });
  }
  if (REVOKED.has(slackError)) return new AppError("SLACK_TOKEN_REVOKED", internal);
  if (CHANNEL_UNAVAILABLE.has(slackError)) return new AppError("SLACK_CHANNEL_UNAVAILABLE", internal);
  if (PERMISSION.has(slackError)) return new AppError("SLACK_PERMISSION_DENIED", internal);
  if (TRANSIENT.has(slackError)) return new AppError("SLACK_UNAVAILABLE", internal, { retryAfterMs });
  if (INVALID_REQUEST.has(slackError)) return new AppError("INTERNAL", internal);

  // Unknown error strings: treat as transient so a bounded retry can happen,
  // but the retry policy caps attempts.
  return new AppError("SLACK_UNAVAILABLE", internal);
}

export function isTokenExpiredError(error: unknown): boolean {
  return error instanceof AppError && /token_expired/.test(error.message);
}
