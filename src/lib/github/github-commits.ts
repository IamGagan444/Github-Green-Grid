import type { Octokit } from "octokit";
import "server-only";

import { toGitHubApiError } from "@/lib/github/errors";
import type { CommitResult } from "@/lib/github/types";

export interface CommitFileParams {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  message: string;
  content: string;
  /** Blob SHA of the file being replaced, or null when creating it. */
  sha: string | null;
}

/**
 * Creates or updates a single file on the default branch through the official
 * Contents API. GitHub attributes the commit to the authenticated user — the
 * author identity is never supplied by GreenGrid.
 */
export async function commitFile(
  octokit: Octokit,
  params: CommitFileParams,
): Promise<CommitResult> {
  try {
    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      branch: params.branch,
      message: params.message,
      content: Buffer.from(params.content, "utf8").toString("base64"),
      ...(params.sha ? { sha: params.sha } : {}),
    });

    const commit = data.commit;
    if (!commit?.sha) {
      throw toGitHubApiError(
        { status: 502 },
        "commitFile: GitHub returned no commit reference",
      );
    }

    return {
      sha: commit.sha,
      url: commit.html_url ?? `https://github.com/${params.owner}/${params.repo}/commit/${commit.sha}`,
      message: params.message,
    };
  } catch (error) {
    throw toGitHubApiError(error, "commitFile");
  }
}

/** Timestamp of the newest commit on a branch, used for "last activity". */
export async function getLatestCommitDate(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<Date | null> {
  try {
    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      sha: branch,
      per_page: 1,
    });

    const first = data[0];
    const date = first?.commit?.committer?.date ?? first?.commit?.author?.date;
    return date ? new Date(date) : null;
  } catch (error) {
    const apiError = toGitHubApiError(error, "getLatestCommitDate");
    // An empty repository has no commits yet; that is not a failure.
    if (apiError.code === "CONFLICT" || apiError.code === "NOT_FOUND") return null;
    throw apiError;
  }
}
