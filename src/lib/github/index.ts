export { getGitHubClient, exchangeOAuthCode, revokeOAuthToken } from "@/lib/github/github-client";
export { fetchProfileWithToken, getAuthenticatedProfile } from "@/lib/github/github-user";
export {
  listUserRepositories,
  getRepository,
  checkRepositoryWritable,
} from "@/lib/github/github-repositories";
export {
  getActivityFile,
  advanceActivityFile,
  serialiseActivityFile,
  createInitialActivityFile,
} from "@/lib/github/github-content";
export { commitFile, getLatestCommitDate } from "@/lib/github/github-commits";
export { GitHubApiError, toGitHubApiError } from "@/lib/github/errors";
export type {
  GitHubUserProfile,
  GitHubRepositorySummary,
  ActivityFileContents,
  ActivityFileState,
  CommitResult,
  RepositoryWriteCheck,
} from "@/lib/github/types";
export { listBranches, fetchAuthoredCommits, MAX_BRANCHES_SCANNED } from "@/lib/github/github-activity";
export { filterAuthoredCommits, sanitiseCommitMessage } from "@/lib/github/commit-filter";
export type {
  GitHubBranchSummary,
  RawCommit,
  CommitQuery,
  AuthoredCommit,
} from "@/lib/github/types";
