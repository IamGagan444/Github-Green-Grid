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

export interface GitHubBranchSummary {
  name: string;
  protected: boolean;
}

/** The fields of GitHub's commit list response that the standup pipeline reads. */
export interface RawCommit {
  sha: string;
  html_url?: string;
  parents?: Array<{ sha: string }>;
  author?: { login?: string; id?: number } | null;
  commit?: {
    message?: string;
    author?: { date?: string | null } | null;
    committer?: { date?: string | null } | null;
  };
}

export interface CommitQuery {
  /** GitHub login of the connected user. */
  authorLogin: string;
  /** Numeric GitHub user id, as a string — matches even after a username change. */
  authorId?: string;
  /** Inclusive lower bound (UTC instant). */
  since: Date;
  /** Exclusive upper bound (UTC instant). */
  until: Date;
  includeFiles?: boolean;
}

export interface AuthoredCommit {
  sha: string;
  repository: string;
  branch: string | null;
  message: string;
  url: string | null;
  authoredAt: string;
  stats: { additions: number; deletions: number; files: string[] } | null;
}
