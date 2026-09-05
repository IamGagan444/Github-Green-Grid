import type { Octokit } from "octokit";
import "server-only";

import { toGitHubApiError } from "@/lib/github/errors";
import type { GitHubRepositorySummary, RepositoryWriteCheck } from "@/lib/github/types";

const PER_PAGE = 100;
const MAX_PAGES = 5;

interface RawRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string;
  html_url: string;
  pushed_at?: string | null;
  owner: { login: string };
  permissions?: { push?: boolean; admin?: boolean; maintain?: boolean };
}

function toSummary(repo: RawRepository): GitHubRepositorySummary {
  const permissions = repo.permissions ?? {};
  return {
    githubRepositoryId: String(repo.id),
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    private: repo.private,
    archived: repo.archived,
    canPush: Boolean(permissions.push || permissions.maintain || permissions.admin),
    htmlUrl: repo.html_url,
    pushedAt: repo.pushed_at ?? null,
  };
}

/**
 * Repositories the authenticated user can act on, most recently pushed first.
 * Capped at MAX_PAGES to bound the request budget against GitHub's rate limit.
 */
export async function listUserRepositories(
  octokit: Octokit,
): Promise<GitHubRepositorySummary[]> {
  const repositories: GitHubRepositorySummary[] = [];

  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: PER_PAGE,
        page,
        sort: "pushed",
        direction: "desc",
        affiliation: "owner,collaborator,organization_member",
      });

      repositories.push(...(data as unknown as RawRepository[]).map(toSummary));
      if (data.length < PER_PAGE) break;
    }
  } catch (error) {
    throw toGitHubApiError(error, "listUserRepositories");
  }

  return repositories;
}

export async function getRepository(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<GitHubRepositorySummary> {
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo: name });
    return toSummary(data as unknown as RawRepository);
  } catch (error) {
    throw toGitHubApiError(error, "getRepository");
  }
}

/**
 * Confirms GreenGrid can safely write to a repository before automation runs.
 * Checks push permission, archived state, and that the default branch exists.
 */
export async function checkRepositoryWritable(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<RepositoryWriteCheck> {
  let repository: GitHubRepositorySummary;

  try {
    repository = await getRepository(octokit, owner, name);
  } catch (error) {
    const apiError = toGitHubApiError(error, "checkRepositoryWritable");
    return { writable: false, reason: apiError.userMessage };
  }

  if (repository.archived) {
    return { writable: false, reason: "This repository is archived and cannot be updated." };
  }

  if (!repository.canPush) {
    return { writable: false, reason: "GreenGrid does not have write access to this repository." };
  }

  try {
    await octokit.rest.repos.getBranch({
      owner,
      repo: name,
      branch: repository.defaultBranch,
    });
  } catch {
    return {
      writable: false,
      reason: `The default branch "${repository.defaultBranch}" could not be found.`,
    };
  }

  return { writable: true, defaultBranch: repository.defaultBranch };
}
