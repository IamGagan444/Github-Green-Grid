import { evaluateTakeover } from "@/lib/automation/takeover";
import type {
  AnchorClaim,
  AnchorKey,
  AutomationSnapshot,
  ClaimInput,
  ClaimResult,
  EngineDeps,
  ExecutionPatch,
  ExecutionStore,
  SlackPort,
  ThreadAnchorStore,
} from "@/lib/automation/types";
import type { AuthoredCommit } from "@/lib/github/types";
import type { SlackHistoryMessage, SlackMessageMetadata } from "@/lib/slack/types";

type Row = {
  id: string;
  idempotencyKey: string;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  attempt: number;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
  aiOutput: ExecutionPatch["aiOutput"] | null;
  messageText: string | null;
  commitCount: number | null;
  slackParentTs: string | null;
  slackReplyTs: string | null;
  errorCode: string | null;
};

/**
 * In-memory ExecutionStore with the same guarantees as the Prisma one: the
 * idempotency key is unique, and create/takeover are atomic (no await between
 * the check and the write, mirroring the database's unique index).
 */
export class MemoryExecutionStore implements ExecutionStore {
  rows = new Map<string, Row>();
  private seq = 0;
  /** Makes the next `update` containing `slackReplyTs` throw — simulates a crash after posting. */
  failNextReplySave = false;

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const lease = new Date(input.now.getTime() + input.leaseMs);
    const existing = this.rows.get(input.idempotencyKey);

    if (!existing) {
      const row: Row = {
        id: `exec_${++this.seq}`,
        idempotencyKey: input.idempotencyKey,
        status: "RUNNING",
        attempt: 1,
        leaseExpiresAt: lease,
        nextRetryAt: null,
        aiOutput: null,
        messageText: null,
        commitCount: null,
        slackParentTs: null,
        slackReplyTs: null,
        errorCode: null,
      };
      this.rows.set(input.idempotencyKey, row);
      return { kind: "claimed", execution: this.view(row) };
    }

    const decision = evaluateTakeover(existing, input.trigger, input.now, input.maxAttempts);
    if (decision === "in_progress") return { kind: "in_progress" };
    if (decision !== "takeover") return { kind: decision, execution: this.view(existing) };

    existing.status = "RUNNING";
    existing.attempt += 1;
    existing.leaseExpiresAt = lease;
    existing.nextRetryAt = null;
    return { kind: "claimed", execution: this.view(existing) };
  }

  async update(executionId: string, patch: ExecutionPatch): Promise<void> {
    const row = [...this.rows.values()].find((entry) => entry.id === executionId);
    if (!row) throw new Error("unknown execution");
    if (patch.slackReplyTs && this.failNextReplySave) {
      this.failNextReplySave = false;
      throw Object.assign(new Error("connection reset"), { code: "P1017" });
    }
    Object.assign(row, patch);
  }

  byKey(key: string): Row | undefined {
    return this.rows.get(key);
  }

  private view(row: Row) {
    return {
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      attempt: row.attempt,
      aiOutput: row.aiOutput ?? null,
      messageText: row.messageText,
      commitCount: row.commitCount,
      slackParentTs: row.slackParentTs,
      slackReplyTs: row.slackReplyTs,
    };
  }
}

export class MemoryAnchorStore implements ThreadAnchorStore {
  anchors = new Map<string, { parentTs: string | null; claimedAt: Date }>();

  private key(key: AnchorKey) {
    return `${key.teamId}|${key.channelId}|${key.dateKey}|${key.anchorKey}`;
  }

  async claim(key: AnchorKey, now: Date, staleAfterMs: number): Promise<AnchorClaim> {
    const id = this.key(key);
    const existing = this.anchors.get(id);
    if (!existing) {
      this.anchors.set(id, { parentTs: null, claimedAt: now });
      return { kind: "claimed" };
    }
    if (existing.parentTs) return { kind: "existing", parentTs: existing.parentTs };
    if (now.getTime() - existing.claimedAt.getTime() > staleAfterMs) {
      existing.claimedAt = now;
      return { kind: "claimed" };
    }
    return { kind: "pending" };
  }

  async set(key: AnchorKey, parentTs: string): Promise<void> {
    const entry = this.anchors.get(this.key(key));
    if (entry) entry.parentTs = parentTs;
  }
}

interface PostedMessage extends SlackHistoryMessage {
  channel: string;
}

/** A single fake Slack workspace shared by every automation in a test. */
export class FakeSlack {
  messages: PostedMessage[] = [];
  private clock = 1_790_000_000;
  /** Simulates a workspace/token type that does not return message metadata. */
  dropMetadata = false;

  post(input: { channel: string; text: string; threadTs?: string; metadata?: SlackMessageMetadata }) {
    this.clock += 1;
    const ts = `${this.clock}.000100`;
    this.messages.push({
      channel: input.channel,
      ts,
      text: input.text,
      bot_id: "B1",
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      ...(input.metadata && !this.dropMetadata ? { metadata: input.metadata } : {}),
    });
    return { ts };
  }

  topLevel(channel: string) {
    return this.messages.filter((message) => message.channel === channel && !message.thread_ts);
  }

  replies(channel: string, parentTs: string) {
    return this.messages.filter(
      (message) => message.channel === channel && (message.ts === parentTs || message.thread_ts === parentTs),
    );
  }

  port(): SlackPort {
    return {
      teamId: async () => "T1",
      prepareChannel: async () => ({ name: "standups" }),
      history: async (channelId) => this.topLevel(channelId),
      replies: async (channelId, parentTs) => this.replies(channelId, parentTs),
      post: async (input) => this.post(input),
      permalink: async (_channelId, ts) => `https://example.slack.com/archives/C1/p${ts.replace(".", "")}`,
    };
  }
}

export function commit(overrides: Partial<AuthoredCommit> = {}): AuthoredCommit {
  return {
    sha: overrides.sha ?? Math.random().toString(16).slice(2).padEnd(40, "0"),
    repository: "acme/api",
    branch: "main",
    message: "Implement token refresh for GitHub integration",
    url: null,
    authoredAt: "2026-09-30T08:00:00.000Z",
    stats: null,
    ...overrides,
  };
}

export function automation(overrides: Partial<AutomationSnapshot> = {}): AutomationSnapshot {
  return {
    id: "auto_1",
    userId: "user_1",
    name: "Daily standup",
    status: "ACTIVE",
    githubSources: [{ repositoryId: "1", owner: "acme", name: "api", fullName: "acme/api", branch: "main" }],
    commitWindow: "SAME_DAY",
    slackIntegrationId: "slack_1",
    slackChannelId: "C1",
    slackChannelName: "standups",
    postingMode: "BOT",
    messageStyle: "CONCISE",
    quickNote: null,
    includeFileStats: false,
    threadMode: "DATE_HEADER",
    headerFormat: "📅 {date}",
    timezone: "Asia/Kolkata",
    ...overrides,
  };
}

export function buildDeps(options: {
  store?: MemoryExecutionStore;
  anchors?: MemoryAnchorStore;
  slack?: FakeSlack;
  commits?: AuthoredCommit[];
  now?: () => Date;
  summarize?: EngineDeps["ai"]["summarize"];
} = {}) {
  const store = options.store ?? new MemoryExecutionStore();
  const anchors = options.anchors ?? new MemoryAnchorStore();
  const slack = options.slack ?? new FakeSlack();
  const commits = options.commits ?? [commit()];
  const calls = { github: 0, ai: 0 };

  const deps: EngineDeps = {
    store,
    anchors,
    github: {
      fetchCommits: async () => {
        calls.github += 1;
        return { commits, perSource: [{ fullName: "acme/api", branch: "main", commitCount: commits.length }] };
      },
    },
    ai: {
      summarize:
        options.summarize ??
        (async () => {
          calls.ai += 1;
          return { summary: { summary: ["Implemented token refresh for the GitHub integration"] }, model: "test-model" };
        }),
    },
    slack: slack.port(),
    now: options.now ?? (() => new Date("2026-09-30T11:30:00.000Z")),
    sleep: async () => undefined,
  };

  return { deps, store, anchors, slack, calls };
}
