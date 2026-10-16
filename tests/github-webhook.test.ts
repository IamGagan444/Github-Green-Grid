import { describe, expect, it } from "vitest";

import { hmacSha256Hex } from "@/lib/encryption";
import { normaliseGitHubEvent, parseInstallationEvent, verifyGitHubSignature } from "@/lib/github/webhook";
import { renderTelegram } from "@/lib/hub/render";

const SECRET = "webhook-secret-value";
const base = {
  installation: { id: 77 },
  repository: { full_name: "Acme/Web", html_url: "https://github.com/Acme/Web" },
  sender: { login: "octocat" },
};

describe("GitHub webhook signature", () => {
  it("accepts the exact HMAC of the raw body only", () => {
    const body = JSON.stringify({ hello: "world" });
    const signature = `sha256=${hmacSha256Hex(SECRET, body)}`;
    expect(verifyGitHubSignature({ secret: SECRET, signature, rawBody: body })).toBe(true);
    expect(verifyGitHubSignature({ secret: SECRET, signature, rawBody: `${body} ` })).toBe(false);
    expect(verifyGitHubSignature({ secret: "other", signature, rawBody: body })).toBe(false);
    expect(verifyGitHubSignature({ secret: SECRET, signature: null, rawBody: body })).toBe(false);
    expect(verifyGitHubSignature({ secret: SECRET, signature: hmacSha256Hex(SECRET, body), rawBody: body })).toBe(false);
  });
});

describe("GitHub event normalisation", () => {
  it("pull_request.opened", () => {
    const event = normaliseGitHubEvent("pull_request", {
      ...base,
      action: "opened",
      pull_request: {
        number: 12,
        title: "Fix <login> **now**",
        html_url: "https://github.com/Acme/Web/pull/12",
        user: { login: "alice" },
        head: { ref: "fix" },
        base: { ref: "main" },
      },
    });
    expect(event?.type).toBe("pull_request.opened");
    expect(event?.installationId).toBe("77");
    expect(event?.attrs.repository).toBe("acme/web");
    // The untrusted title is rendered literally.
    expect(renderTelegram(event!.message).text).toContain("Fix &lt;login&gt; **now**");
  });

  it("review_requested names the reviewer", () => {
    const event = normaliseGitHubEvent("pull_request", {
      ...base,
      action: "review_requested",
      pull_request: { number: 3, title: "x", html_url: "https://github.com/Acme/Web/pull/3", user: { login: "a" } },
      requested_reviewer: { login: "bob" },
    });
    expect(event?.type).toBe("pull_request.review_requested");
    expect(event?.attrs.reviewer).toBe("bob");
  });

  it("check_suite notifies only on failure", () => {
    const suite = (conclusion: string) => ({
      ...base,
      action: "completed",
      check_suite: { conclusion, head_branch: "main", head_sha: "abcdef1234567", app: { name: "GitHub Actions" } },
    });
    expect(normaliseGitHubEvent("check_suite", suite("success"))).toBeNull();
    const failed = normaliseGitHubEvent("check_suite", suite("failure"));
    expect(failed?.type).toBe("check_suite.failed");
    expect(failed?.message.severity).toBe("critical");
  });

  it("release.published and issues.opened", () => {
    expect(
      normaliseGitHubEvent("release", {
        ...base,
        action: "published",
        release: { tag_name: "v1.2.0", name: "Big one", html_url: "https://github.com/Acme/Web/releases/v1.2.0" },
      })?.type,
    ).toBe("release.published");
    expect(
      normaliseGitHubEvent("issues", {
        ...base,
        action: "opened",
        issue: { number: 9, title: "Bug", html_url: "https://github.com/Acme/Web/issues/9", user: { login: "c" } },
      })?.type,
    ).toBe("issues.opened");
  });

  it("ignores unsupported events and malformed payloads", () => {
    expect(normaliseGitHubEvent("push", { ...base, action: "x" })).toBeNull();
    expect(normaliseGitHubEvent("pull_request", { ...base, action: "closed" })).toBeNull();
    expect(normaliseGitHubEvent("pull_request", { action: "opened" })).toBeNull();
  });
});

describe("installation events", () => {
  it("maps created and deleted installations", () => {
    const created = parseInstallationEvent("installation", {
      action: "created",
      installation: { id: 5, account: { id: 9, login: "acme", type: "Organization" }, repository_selection: "selected" },
      sender: { id: 1234, login: "alice" },
    });
    expect(created).toMatchObject({ kind: "upsert", installationId: "5", senderGitHubId: "1234", accountLogin: "acme" });
    expect(
      parseInstallationEvent("installation", { action: "deleted", installation: { id: 5 }, sender: { id: 1, login: "a" } }),
    ).toEqual({ kind: "delete", installationId: "5" });
    expect(parseInstallationEvent("pull_request", {})).toBeNull();
  });
});
