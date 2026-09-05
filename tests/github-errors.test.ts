import { describe, expect, it } from "vitest";

import { GitHubApiError, toGitHubApiError } from "@/lib/github/errors";

describe("toGitHubApiError", () => {
  it("maps 401 to an expired connection", () => {
    const error = toGitHubApiError({ status: 401 }, "test");
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.userMessage).toBe("Your GitHub connection needs to be renewed.");
    expect(error.retryable).toBe(false);
  });

  it("maps a plain 403 to lost write access", () => {
    const error = toGitHubApiError({ status: 403, message: "Resource not accessible" }, "test");
    expect(error.code).toBe("FORBIDDEN");
    expect(error.retryable).toBe(false);
  });

  it("maps an exhausted 403 to a rate limit", () => {
    const error = toGitHubApiError(
      { status: 403, response: { headers: { "x-ratelimit-remaining": "0" } } },
      "test",
    );
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.userMessage).toBe("GitHub API rate limit reached. We'll retry later.");
    expect(error.retryable).toBe(true);
  });

  it("maps a secondary rate limit message on 403", () => {
    const error = toGitHubApiError(
      { status: 403, message: "You have exceeded a secondary rate limit" },
      "test",
    );
    expect(error.code).toBe("RATE_LIMITED");
  });

  it("maps 404, 409, 422 and 429", () => {
    expect(toGitHubApiError({ status: 404 }, "t").code).toBe("NOT_FOUND");
    expect(toGitHubApiError({ status: 409 }, "t").code).toBe("CONFLICT");
    expect(toGitHubApiError({ status: 422 }, "t").code).toBe("VALIDATION_FAILED");
    expect(toGitHubApiError({ status: 429 }, "t").code).toBe("RATE_LIMITED");
  });

  it("treats a conflict as retryable", () => {
    expect(toGitHubApiError({ status: 409 }, "t").retryable).toBe(true);
  });

  it("falls back to UNAVAILABLE for network failures", () => {
    const error = toGitHubApiError(new Error("socket hang up"), "test");
    expect(error.code).toBe("UNAVAILABLE");
    expect(error.retryable).toBe(true);
  });

  it("passes through an existing GitHubApiError unchanged", () => {
    const original = new GitHubApiError("NOT_FOUND", 404, "internal detail");
    expect(toGitHubApiError(original, "test")).toBe(original);
  });

  it("never leaks the raw GitHub message into the user-facing text", () => {
    const error = toGitHubApiError(
      { status: 401, message: "Bad credentials for token ghp_supersecretvalue" },
      "test",
    );
    expect(error.userMessage).not.toContain("ghp_");
    expect(error.message).not.toContain("ghp_");
  });
});
