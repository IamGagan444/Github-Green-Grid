import { z } from "zod";

import { hmacSha256Hex, safeCompare } from "@/lib/encryption";
import { hubMessage, md, type HubMessage } from "@/lib/hub/message";
import type { EventAttrs, GitHubEventType } from "@/lib/hub/rules";

/**
 * GitHub App webhook deliveries: signature check and normalisation into hub
 * events. Only the fields a notification needs are kept; the raw payload is
 * never stored.
 */

/** X-Hub-Signature-256: sha256=HMAC_SHA256(secret, rawBody), compared in constant time. */
export function verifyGitHubSignature(input: { secret: string; signature: string | null; rawBody: string }): boolean {
  if (!input.signature?.startsWith("sha256=")) return false;
  return safeCompare(`sha256=${hmacSha256Hex(input.secret, input.rawBody)}`, input.signature);
}

const account = z.object({ id: z.number(), login: z.string(), type: z.string().optional() });
const user = z.object({ login: z.string(), id: z.number().optional() }).nullable().optional();
const repository = z.object({ full_name: z.string(), html_url: z.string() });

const installationEnvelope = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number(),
    account: account.nullable().optional(),
    repository_selection: z.string().optional(),
  }),
  sender: z.object({ id: z.number(), login: z.string() }),
});

export type InstallationChange =
  | {
      kind: "upsert";
      installationId: string;
      senderGitHubId: string;
      accountId: string;
      accountLogin: string;
      accountType: string;
      repositorySelection: string | null;
      suspended: boolean | null;
    }
  | { kind: "delete"; installationId: string };

/** `installation` and `installation_repositories` events. */
export function parseInstallationEvent(eventName: string, payload: unknown): InstallationChange | null {
  if (eventName !== "installation" && eventName !== "installation_repositories") return null;
  const parsed = installationEnvelope.safeParse(payload);
  if (!parsed.success) return null;
  const { action, installation, sender } = parsed.data;
  const installationId = String(installation.id);

  if (eventName === "installation" && action === "deleted") return { kind: "delete", installationId };
  return {
    kind: "upsert",
    installationId,
    senderGitHubId: String(sender.id),
    accountId: String(installation.account?.id ?? sender.id),
    accountLogin: installation.account?.login ?? sender.login,
    accountType: installation.account?.type ?? "User",
    repositorySelection: installation.repository_selection ?? null,
    suspended: action === "suspend" ? true : action === "unsuspend" ? false : null,
  };
}

export interface NormalisedGitHubEvent {
  type: GitHubEventType;
  installationId: string;
  attrs: EventAttrs;
  message: HubMessage;
}

const base = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }),
  repository,
  sender: z.object({ login: z.string() }),
});

const pullRequestPayload = base.extend({
  pull_request: z.object({
    number: z.number(),
    title: z.string(),
    html_url: z.string(),
    draft: z.boolean().optional(),
    user: user,
    head: z.object({ ref: z.string() }).optional(),
    base: z.object({ ref: z.string() }).optional(),
  }),
  requested_reviewer: user,
  requested_team: z.object({ name: z.string() }).nullable().optional(),
});

const checkSuitePayload = base.extend({
  check_suite: z.object({
    conclusion: z.string().nullable(),
    head_branch: z.string().nullable().optional(),
    head_sha: z.string(),
    app: z.object({ name: z.string() }).nullable().optional(),
  }),
});

const releasePayload = base.extend({
  release: z.object({
    tag_name: z.string(),
    name: z.string().nullable(),
    html_url: z.string(),
    prerelease: z.boolean().optional(),
  }),
});

const issuePayload = base.extend({
  issue: z.object({ number: z.number(), title: z.string(), html_url: z.string(), user: user }),
});

const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);

/** Maps a delivery to a hub event, or null when it is not one we notify on. */
export function normaliseGitHubEvent(eventName: string, payload: unknown): NormalisedGitHubEvent | null {
  const action = (payload as { action?: unknown } | null)?.action;

  if (eventName === "pull_request" && (action === "opened" || action === "review_requested")) {
    const parsed = pullRequestPayload.safeParse(payload);
    if (!parsed.success) return null;
    const { pull_request: pr, repository: repo, sender, installation } = parsed.data;
    const opened = action === "opened";
    const reviewer = parsed.data.requested_reviewer?.login ?? parsed.data.requested_team?.name ?? null;
    const type: GitHubEventType = opened ? "pull_request.opened" : "pull_request.review_requested";

    const lines = [
      `${md.bold(md.text(`#${pr.number}`))} ${md.text(pr.title, 200)}`,
      opened
        ? `Opened by ${md.text(pr.user?.login ?? sender.login, 60)}${pr.head && pr.base ? ` · ${md.code(pr.head.ref.slice(0, 60))} → ${md.code(pr.base.ref.slice(0, 60))}` : ""}${pr.draft ? " · draft" : ""}`
        : `${md.text(sender.login, 60)} requested a review${reviewer ? ` from ${md.text(reviewer, 60)}` : ""}`,
    ];
    return {
      type,
      installationId: String(installation.id),
      attrs: { repository: repo.full_name.toLowerCase(), number: pr.number, reviewer },
      message: hubMessage({
        title: `${opened ? "New pull request" : "Review requested"} in ${repo.full_name}`,
        body: lines.join("\n"),
        buttons: [{ label: "Open pull request", url: pr.html_url }],
        severity: "info",
      }),
    };
  }

  if (eventName === "check_suite" && action === "completed") {
    const parsed = checkSuitePayload.safeParse(payload);
    if (!parsed.success) return null;
    const { check_suite: suite, repository: repo, installation } = parsed.data;
    if (!suite.conclusion || !FAILED_CONCLUSIONS.has(suite.conclusion)) return null;
    const commitUrl = `${repo.html_url}/commit/${suite.head_sha}`;
    return {
      type: "check_suite.failed",
      installationId: String(installation.id),
      attrs: { repository: repo.full_name.toLowerCase(), branch: suite.head_branch ?? null },
      message: hubMessage({
        title: `Checks failed in ${repo.full_name}`,
        body: [
          `${md.bold(md.text(suite.app?.name ?? "Checks"))} finished with ${md.code(suite.conclusion)}`,
          `Branch ${md.code((suite.head_branch ?? "unknown").slice(0, 80))} · commit ${md.code(suite.head_sha.slice(0, 7))}`,
        ].join("\n"),
        buttons: [{ label: "View commit checks", url: `${commitUrl}/checks` }],
        severity: "critical",
      }),
    };
  }

  if (eventName === "release" && action === "published") {
    const parsed = releasePayload.safeParse(payload);
    if (!parsed.success) return null;
    const { release, repository: repo, sender, installation } = parsed.data;
    return {
      type: "release.published",
      installationId: String(installation.id),
      attrs: { repository: repo.full_name.toLowerCase(), prerelease: release.prerelease ?? false },
      message: hubMessage({
        title: `${repo.full_name} ${release.tag_name.slice(0, 60)} released`,
        body: `${md.bold(md.text(release.name || release.tag_name, 120))}${release.prerelease ? " (pre-release)" : ""}\nPublished by ${md.text(sender.login, 60)}`,
        buttons: [{ label: "Release notes", url: release.html_url }],
        severity: "success",
      }),
    };
  }

  if (eventName === "issues" && action === "opened") {
    const parsed = issuePayload.safeParse(payload);
    if (!parsed.success) return null;
    const { issue, repository: repo, sender, installation } = parsed.data;
    return {
      type: "issues.opened",
      installationId: String(installation.id),
      attrs: { repository: repo.full_name.toLowerCase(), number: issue.number },
      message: hubMessage({
        title: `New issue in ${repo.full_name}`,
        body: `${md.bold(md.text(`#${issue.number}`))} ${md.text(issue.title, 200)}\nOpened by ${md.text(issue.user?.login ?? sender.login, 60)}`,
        buttons: [{ label: "Open issue", url: issue.html_url }],
        severity: "info",
      }),
    };
  }

  return null;
}
