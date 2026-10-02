import type { AiSummary } from "@/lib/ai/schema";
import type { AuthoredCommit } from "@/lib/github/types";
import type { SlackHistoryMessage, SlackMessageMetadata } from "@/lib/slack/types";
import type { GitHubSource } from "@/validators/automation";
import type {
  AutomationStatus,
  CommitWindow,
  MessageStyle,
  RunStatus,
  RunTrigger,
  SlackPostingMode,
  StepStatus,
  ThreadMode,
} from "@/generated/prisma/enums";

export interface AutomationSnapshot {
  id: string;
  userId: string;
  name: string;
  status: AutomationStatus;
  githubSources: GitHubSource[];
  commitWindow: CommitWindow;
  slackIntegrationId: string | null;
  slackChannelId: string;
  slackChannelName: string;
  postingMode: SlackPostingMode;
  messageStyle: MessageStyle;
  quickNote: string | null;
  includeFileStats: boolean;
  threadMode: ThreadMode;
  headerFormat: string;
  timezone: string;
}

export interface ExecutionRow {
  id: string;
  idempotencyKey: string;
  status: RunStatus;
  attempt: number;
  aiOutput: AiSummary | null;
  messageText: string | null;
  commitCount: number | null;
  slackParentTs: string | null;
  slackReplyTs: string | null;
  /** Commit range fixed at creation; null only on legacy rows. */
  windowStart: Date | null;
  windowEnd: Date | null;
}

export interface CommitRange {
  /** Local day the range belongs to, for labels ("YYYY-MM-DD"). */
  dateKey: string;
  since: Date;
  until: Date;
}

export interface ExecutionPatch {
  status?: RunStatus;
  githubStatus?: StepStatus;
  aiStatus?: StepStatus;
  slackStatus?: StepStatus;
  repositories?: Array<{ fullName: string; branch: string | null; commitCount: number }>;
  commitCount?: number;
  aiOutput?: AiSummary;
  aiModel?: string;
  messageText?: string;
  slackTeamId?: string;
  slackChannelId?: string;
  slackChannelName?: string;
  slackParentTs?: string | null;
  slackReplyTs?: string;
  slackPermalink?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  finishedAt?: Date;
  durationMs?: number;
  leaseExpiresAt?: Date | null;
  nextRetryAt?: Date | null;
}

export type ClaimResult =
  | { kind: "claimed"; execution: ExecutionRow }
  | { kind: "already_done"; execution: ExecutionRow }
  | { kind: "in_progress" }
  | { kind: "not_retryable"; execution: ExecutionRow }
  | { kind: "retry_not_due"; execution: ExecutionRow };

export interface ClaimInput {
  automation: Pick<AutomationSnapshot, "id" | "userId" | "name">;
  executionDate: string;
  slot: string;
  /** Stored on a newly created row; an existing row keeps its own range. */
  window: CommitRange;
  idempotencyKey: string;
  trigger: RunTrigger;
  scheduledFor: Date | null;
  now: Date;
  leaseMs: number;
  maxAttempts: number;
}

/** Persistence for executions. The Prisma implementation enforces uniqueness. */
export interface ExecutionStore {
  claim(input: ClaimInput): Promise<ClaimResult>;
  update(executionId: string, patch: ExecutionPatch): Promise<void>;
}

export type AnchorClaim =
  | { kind: "existing"; parentTs: string }
  | { kind: "claimed" }
  | { kind: "pending" };

export interface AnchorKey {
  teamId: string;
  channelId: string;
  dateKey: string;
  anchorKey: string;
}

/** One parent message per channel per day, enforced by a unique index. */
export interface ThreadAnchorStore {
  claim(key: AnchorKey, now: Date, staleAfterMs: number): Promise<AnchorClaim>;
  set(key: AnchorKey, parentTs: string): Promise<void>;
}

export interface GitHubPort {
  fetchCommits(
    automation: AutomationSnapshot,
    window: { since: Date; until: Date },
  ): Promise<{ commits: AuthoredCommit[]; perSource: Array<{ fullName: string; branch: string | null; commitCount: number }> }>;
}

export interface AiPort {
  summarize(input: {
    commits: AuthoredCommit[];
    automation: AutomationSnapshot;
    dateLabel: string;
  }): Promise<{ summary: AiSummary; model: string }>;
}

/** A Slack session bound to the automation's workspace and posting identity. */
export interface SlackPort {
  teamId(): Promise<string>;
  /** Verifies access and joins public channels in bot mode. */
  prepareChannel(channelId: string): Promise<{ name: string }>;
  history(channelId: string, oldestEpochSeconds: number): Promise<SlackHistoryMessage[]>;
  replies(channelId: string, parentTs: string): Promise<SlackHistoryMessage[]>;
  post(input: {
    channel: string;
    text: string;
    threadTs?: string;
    metadata: SlackMessageMetadata;
  }): Promise<{ ts: string }>;
  permalink(channelId: string, ts: string): Promise<string | null>;
}

export interface EngineDeps {
  store: ExecutionStore;
  anchors: ThreadAnchorStore;
  github: GitHubPort;
  ai: AiPort;
  slack: SlackPort;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export type EngineOutcome =
  | { status: "SUCCESS"; executionId: string; resumed: boolean }
  | { status: "SKIPPED"; executionId: string | null; reason: string }
  | { status: "FAILED"; executionId: string; code: string; message: string; retryable: boolean }
  | { status: "NOOP"; executionId: string | null; reason: "already_done" | "in_progress" | "not_retryable" | "retry_not_due" };
