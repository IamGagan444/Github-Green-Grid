import "server-only";

import { AppError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { slackErrorToAppError } from "@/lib/slack/errors";
import type {
  SlackChannel,
  SlackHistoryMessage,
  SlackMessageMetadata,
} from "@/lib/slack/types";

const SLACK_API = "https://slack.com/api";
const REQUEST_TIMEOUT_MS = 15_000;

type Params = Record<string, string | number | boolean | undefined>;

interface SlackResponse {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
  [key: string]: unknown;
}

/**
 * Minimal Slack Web API client over `fetch`.
 *
 * - Form-encoded POSTs work for every method we call (read and write).
 * - The token is only ever placed in the Authorization header; it is never
 *   logged and never included in thrown errors.
 * - HTTP 429 honours `Retry-After`; `ok: false` responses map to AppErrors.
 */
export async function callSlack<T extends SlackResponse>(
  method: string,
  token: string | null,
  params: Params = {},
): Promise<T> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("SLACK_UNAVAILABLE", `slack ${method}: network error or timeout`);
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "1");
    throw slackErrorToAppError("ratelimited", method, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000);
  }
  if (response.status >= 500) {
    throw new AppError("SLACK_UNAVAILABLE", `slack ${method}: HTTP ${response.status}`);
  }

  let payload: T;
  try {
    payload = (await response.json()) as T;
  } catch {
    throw new AppError("SLACK_UNAVAILABLE", `slack ${method}: non-JSON response`);
  }

  if (!payload.ok) throw slackErrorToAppError(payload.error ?? "unknown_error", method);
  return payload;
}

/** `callSlack` with exponential backoff for transient failures. */
export function callSlackWithRetry<T extends SlackResponse>(
  method: string,
  token: string,
  params: Params = {},
): Promise<T> {
  return withRetry(() => callSlack<T>(method, token, params), { attempts: 3, baseDelayMs: 750 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed wrappers
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthTestResult {
  userId: string;
  teamId: string;
  team: string;
  url: string | null;
  botId: string | null;
}

export async function authTest(token: string): Promise<AuthTestResult> {
  const data = await callSlackWithRetry<
    SlackResponse & { user_id: string; team_id: string; team: string; url?: string; bot_id?: string }
  >("auth.test", token);
  return {
    userId: data.user_id,
    teamId: data.team_id,
    team: data.team,
    url: data.url ?? null,
    botId: data.bot_id ?? null,
  };
}

const MAX_CHANNEL_PAGES = 10;

export async function listChannels(token: string): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
    const data = await callSlackWithRetry<
      SlackResponse & {
        channels: Array<{
          id: string;
          name: string;
          is_private?: boolean;
          is_member?: boolean;
          is_archived?: boolean;
          num_members?: number;
        }>;
      }
    >("conversations.list", token, {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      cursor,
    });

    for (const channel of data.channels ?? []) {
      if (channel.is_archived) continue;
      channels.push({
        id: channel.id,
        name: channel.name,
        isPrivate: Boolean(channel.is_private),
        isMember: Boolean(channel.is_member),
        memberCount: channel.num_members ?? null,
      });
    }

    cursor = data.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }

  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getChannel(token: string, channelId: string): Promise<SlackChannel> {
  const data = await callSlackWithRetry<
    SlackResponse & {
      channel: { id: string; name: string; is_private?: boolean; is_member?: boolean; is_archived?: boolean; num_members?: number };
    }
  >("conversations.info", token, { channel: channelId });

  if (data.channel.is_archived) {
    throw new AppError("SLACK_CHANNEL_UNAVAILABLE", "slack conversations.info: channel archived");
  }
  return {
    id: data.channel.id,
    name: data.channel.name,
    isPrivate: Boolean(data.channel.is_private),
    isMember: Boolean(data.channel.is_member),
    memberCount: data.channel.num_members ?? null,
  };
}

export async function joinChannel(token: string, channelId: string): Promise<void> {
  await callSlackWithRetry("conversations.join", token, { channel: channelId });
}

const MAX_HISTORY_PAGES = 5;

/** Top-level channel messages in [oldest, latest], with metadata. */
export async function channelHistory(
  token: string,
  channelId: string,
  oldestEpochSeconds: number,
  latestEpochSeconds?: number,
): Promise<SlackHistoryMessage[]> {
  const messages: SlackHistoryMessage[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const data = await callSlackWithRetry<SlackResponse & { messages: SlackHistoryMessage[]; has_more?: boolean }>(
      "conversations.history",
      token,
      {
        channel: channelId,
        oldest: oldestEpochSeconds.toFixed(6),
        ...(latestEpochSeconds ? { latest: latestEpochSeconds.toFixed(6) } : {}),
        inclusive: true,
        include_all_metadata: true,
        limit: 200,
        cursor,
      },
    );
    messages.push(...(data.messages ?? []));
    cursor = data.response_metadata?.next_cursor || undefined;
    if (!cursor || !data.has_more) break;
  }

  return messages;
}

export async function threadReplies(
  token: string,
  channelId: string,
  parentTs: string,
): Promise<SlackHistoryMessage[]> {
  const messages: SlackHistoryMessage[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const data = await callSlackWithRetry<SlackResponse & { messages: SlackHistoryMessage[]; has_more?: boolean }>(
      "conversations.replies",
      token,
      { channel: channelId, ts: parentTs, include_all_metadata: true, limit: 200, cursor },
    );
    messages.push(...(data.messages ?? []));
    cursor = data.response_metadata?.next_cursor || undefined;
    if (!cursor || !data.has_more) break;
  }

  return messages;
}

export interface PostMessageInput {
  channel: string;
  text: string;
  threadTs?: string;
  metadata?: SlackMessageMetadata;
}

/**
 * Posts a message. NOT retried automatically: chat.postMessage has no
 * idempotency key, so a blind retry after a timeout could post twice. Callers
 * re-check the channel (via message metadata) before any retry.
 */
export async function postMessage(token: string, input: PostMessageInput): Promise<{ ts: string; channel: string }> {
  const data = await callSlack<SlackResponse & { ts: string; channel: string }>("chat.postMessage", token, {
    channel: input.channel,
    text: input.text,
    thread_ts: input.threadTs,
    mrkdwn: true,
    unfurl_links: false,
    unfurl_media: false,
    ...(input.metadata ? { metadata: JSON.stringify(input.metadata) } : {}),
  });
  return { ts: data.ts, channel: data.channel };
}

export async function getPermalink(token: string, channelId: string, ts: string): Promise<string | null> {
  try {
    const data = await callSlack<SlackResponse & { permalink: string }>("chat.getPermalink", token, {
      channel: channelId,
      message_ts: ts,
    });
    return data.permalink.startsWith("https://") ? data.permalink : null;
  } catch {
    return null;
  }
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await callSlack("auth.revoke", token);
  } catch {
    // Best effort; local credentials are deleted regardless.
  }
}
