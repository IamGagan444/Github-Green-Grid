import type { Octokit } from "octokit";
import "server-only";

import { toGitHubApiError } from "@/lib/github/errors";
import type { AuthoredCommit, CommitQuery, GitHubBranchSummary, RawCommit } from "@/lib/github/types";
import { filterAuthoredCommits } from "@/lib/github/commit-filter";

const PER_PAGE = 100;
const MAX_COMMIT_PAGES = 3;
const MAX_BRANCH_PAGES = 3;
/** Upper bound on branches scanned in "all branches" mode, to bound API usage. */
export const MAX_BRANCHES_SCANNED = 30;
/** Upper bound on commits enriched with file statistics (one request each). */
const MAX_COMMITS_WITH_FILES = 15;
const MAX_FILES_PER_COMMIT = 8;

export async function listBranches(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<GitHubBranchSummary[]> {
  const branches: GitHubBranchSummary[] = [];
  try {
    for (let page = 1; page <= MAX_BRANCH_PAGES; page += 1) {
      const { data } = await octokit.rest.repos.listBranches({ owner, repo, per_page: PER_PAGE, page });
      branches.push(
        ...data.map((branch) => ({ name: branch.name, protected: Boolean(branch.protected) })),
      );
      if (data.length < PER_PAGE) break;
    }
  } catch (error) {
    throw toGitHubApiError(error, "listBranches");
  }
  return branches;
}

async function listCommitsOnRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string | undefined,
  query: CommitQuery,
): Promise<RawCommit[]> {
  const commits: RawCommit[] = [];
  try {
    for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
      const { data } = await octokit.rest.repos.listCommits({
        owner,
        repo,
        ...(ref ? { sha: ref } : {}),
        author: query.authorLogin,
        since: query.since.toISOString(),
        until: query.until.toISOString(),
        per_page: PER_PAGE,
        page,
      });
      commits.push(...(data as unknown as RawCommit[]));
      if (data.length < PER_PAGE) break;
    }
  } catch (error) {
    const apiError = toGitHubApiError(error, "listCommits");
    // 409 = empty repository: no commits is not a failure.
    if (apiError.code === "CONFLICT") return [];
    throw apiError;
  }
  return commits;
}

/**
 * Commits authored by `query.authorLogin` inside [since, until) on one branch,
 * or on every branch (deduplicated by SHA) when `branch` is null.
 *
 * GitHub's `author` filter is applied server-side, then re-checked locally by
 * `filterAuthoredCommits`, which also enforces the time window and drops merge
 * commits — so nothing outside the user's own work reaches the AI.
 */
export async function fetchAuthoredCommits(
  octokit: Octokit,
  source: { owner: string; name: string; fullName: string; branch: string | null },
  query: CommitQuery,
): Promise<AuthoredCommit[]> {
  const refs: Array<string | undefined> = [];

  if (source.branch) {
    refs.push(source.branch);
  } else {
    const branches = await listBranches(octokit, source.owner, source.name);
    refs.push(...branches.slice(0, MAX_BRANCHES_SCANNED).map((branch) => branch.name));
    if (refs.length === 0) refs.push(undefined); // default branch
  }

  const bySha = new Map<string, { raw: RawCommit; branch: string | null }>();
  for (const ref of refs) {
    const commits = await listCommitsOnRef(octokit, source.owner, source.name, ref, query);
    for (const raw of commits) {
      if (!bySha.has(raw.sha)) bySha.set(raw.sha, { raw, branch: ref ?? null });
    }
  }

  const authored = filterAuthoredCommits(
    [...bySha.values()].map(({ raw, branch }) => ({ raw, branch, repository: source.fullName })),
    query,
  );

  if (!query.includeFiles) return authored;

  for (const commit of authored.slice(0, MAX_COMMITS_WITH_FILES)) {
    try {
      const { data } = await octokit.rest.repos.getCommit({
        owner: source.owner,
        repo: source.name,
        ref: commit.sha,
      });
      commit.stats = {
        additions: data.stats?.additions ?? 0,
        deletions: data.stats?.deletions ?? 0,
        files: (data.files ?? []).slice(0, MAX_FILES_PER_COMMIT).map((file) => file.filename),
      };
    } catch {
      // File statistics are optional enrichment; the summary works without them.
    }
  }

  return authored;
}
