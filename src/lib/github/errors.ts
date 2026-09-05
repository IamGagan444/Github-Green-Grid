/**
 * Normalises Octokit/GitHub failures into a small, user-safe error type.
 * Raw GitHub responses can echo request headers, so they are never surfaced.
 */

export type GitHubErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "UNAVAILABLE";

const USER_MESSAGE: Record<GitHubErrorCode, string> = {
  UNAUTHORIZED: "Your GitHub connection needs to be renewed.",
  FORBIDDEN: "GreenGrid can no longer write to this repository.",
  NOT_FOUND: "That repository or file could not be found on GitHub.",
  CONFLICT: "The repository changed while GreenGrid was updating it. It will retry later.",
  VALIDATION_FAILED: "GitHub rejected the update as invalid.",
  RATE_LIMITED: "GitHub API rate limit reached. We'll retry later.",
  UNAVAILABLE: "GitHub is temporarily unavailable. We'll retry later.",
};

export class GitHubApiError extends Error {
  readonly code: GitHubErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  /** Message safe to render in the UI. */
  readonly userMessage: string;

  constructor(code: GitHubErrorCode, status: number, internalMessage: string) {
    super(internalMessage);
    this.name = "GitHubApiError";
    this.code = code;
    this.status = status;
    this.userMessage = USER_MESSAGE[code];
    this.retryable = code === "RATE_LIMITED" || code === "UNAVAILABLE" || code === "CONFLICT";
  }
}

interface OctokitLikeError {
  status?: number;
  message?: string;
  response?: { headers?: Record<string, string | undefined> };
}

function isRateLimited(error: OctokitLikeError): boolean {
  const remaining = error.response?.headers?.["x-ratelimit-remaining"];
  return remaining === "0" || /rate limit|secondary rate/i.test(error.message ?? "");
}

/** Maps an unknown thrown value to a `GitHubApiError`. */
export function toGitHubApiError(error: unknown, context: string): GitHubApiError {
  if (error instanceof GitHubApiError) return error;

  const candidate = error as OctokitLikeError;
  const status = typeof candidate?.status === "number" ? candidate.status : 0;

  // The internal message is logged server-side only; it never includes tokens
  // because Octokit redacts the Authorization header before throwing.
  const internal = `${context}: GitHub responded ${status || "with a network error"}`;

  switch (status) {
    case 401:
      return new GitHubApiError("UNAUTHORIZED", 401, internal);
    case 403:
      return isRateLimited(candidate)
        ? new GitHubApiError("RATE_LIMITED", 403, internal)
        : new GitHubApiError("FORBIDDEN", 403, internal);
    case 404:
      return new GitHubApiError("NOT_FOUND", 404, internal);
    case 409:
      return new GitHubApiError("CONFLICT", 409, internal);
    case 422:
      return new GitHubApiError("VALIDATION_FAILED", 422, internal);
    case 429:
      return new GitHubApiError("RATE_LIMITED", 429, internal);
    default:
      return new GitHubApiError("UNAVAILABLE", status || 503, internal);
  }
}
