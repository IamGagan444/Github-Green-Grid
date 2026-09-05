export interface GitHubUserProfile {
  githubUserId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

export interface GitHubRepositorySummary {
  githubRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  canPush: boolean;
  htmlUrl: string;
  pushedAt: string | null;
}

export interface ActivityFileContents {
  version: number;
  lastActivity: string;
  runs: number;
  history?: string[];
}

export interface ActivityFileState {
  contents: ActivityFileContents;
  /** Blob SHA of the existing file, or null when it does not exist yet. */
  sha: string | null;
}

export interface CommitResult {
  sha: string;
  url: string;
  message: string;
}

/** Write-eligibility check performed before any automation is enabled. */
export interface RepositoryWriteCheck {
  writable: boolean;
  reason?: string;
  defaultBranch?: string;
}
