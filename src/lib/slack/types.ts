export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  /** Whether the token's identity (bot or user) is a member of the channel. */
  isMember: boolean;
  memberCount: number | null;
}

export interface SlackMessageMetadata {
  event_type: string;
  event_payload: Record<string, string | number | boolean>;
}

export interface SlackHistoryMessage {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  thread_ts?: string;
  metadata?: SlackMessageMetadata;
}

/** Event types GreenGrid attaches to its own messages, used for dedupe. */
export const HEADER_EVENT_TYPE = "greengrid_date_header";
export const UPDATE_EVENT_TYPE = "greengrid_standup_update";
/** Test posts are tagged separately so they are never mistaken for a daily header or update. */
export const TEST_EVENT_TYPE = "greengrid_standup_test";
