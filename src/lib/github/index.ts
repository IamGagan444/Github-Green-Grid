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
