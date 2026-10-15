import { AppError } from "@/lib/errors";

/**
 * Maps a Graph API error (`{ error: { code, error_subcode, type, message } }`)
 * to an AppError. Graph messages can echo request data, so they stay in the
 * internal message only.
 *
 * Reference: https://developers.facebook.com/docs/graph-api/guides/error-handling
 */

export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

// Throttling: application, user, page/account and business-use-case limits.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002, 80006]);
// Permission errors (missing scope, not granted, app not approved).
const PERMISSION_CODES = new Set([10, 200, 3, 299]);
// "Message sent outside of allowed window" and similar — code 10, but not a
// missing permission.
const OUTSIDE_WINDOW_SUBCODES = new Set([2534022, 2018278]);
// Temporary / unknown server-side errors.
const TRANSIENT_CODES = new Set([1, 2, -1, -2]);

export function graphErrorToAppError(
  body: GraphErrorBody | undefined,
  context: string,
  httpStatus: number,
  retryAfterMs: number | null = null,
): AppError {
  const code = body?.code;
  const detail = `instagram ${context}: HTTP ${httpStatus} code=${code ?? "?"} subcode=${body?.error_subcode ?? "?"}`;

  if (code === 190 || (body?.type === "OAuthException" && httpStatus === 401)) {
    return new AppError("INSTAGRAM_TOKEN_REVOKED", detail);
  }
  if ((code !== undefined && RATE_LIMIT_CODES.has(code)) || httpStatus === 429) {
    return new AppError("INSTAGRAM_RATE_LIMITED", detail, { retryAfterMs: retryAfterMs ?? 60_000 });
  }
  if (body?.error_subcode !== undefined && OUTSIDE_WINDOW_SUBCODES.has(body.error_subcode)) {
    return new AppError("INSTAGRAM_REQUEST_REJECTED", detail);
  }
  if (code !== undefined && PERMISSION_CODES.has(code)) {
    return new AppError("INSTAGRAM_PERMISSION_DENIED", detail);
  }
  if (httpStatus >= 500 || (code !== undefined && TRANSIENT_CODES.has(code))) {
    return new AppError("INSTAGRAM_UNAVAILABLE", detail);
  }
  // Everything else (code 100 invalid parameter, 551 user unavailable, 10 with
  // the "outside allowed window" subcode, ...) is a permanent rejection.
  return new AppError("INSTAGRAM_REQUEST_REJECTED", detail);
}
