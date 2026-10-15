import "server-only";

import { getInstagramConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { graphErrorToAppError, type GraphErrorBody } from "@/lib/instagram/errors";
import type { OutgoingMessage } from "@/lib/instagram/types";

const GRAPH_HOST = "https://graph.instagram.com";
const REQUEST_TIMEOUT_MS = 15_000;

type Query = Record<string, string | number | undefined>;

/**
 * Minimal Instagram Graph API client (Instagram API with Instagram Login).
 *
 * The token is only ever sent in the Authorization header — never in a URL,
 * a log line or a thrown error.
 */
export async function callGraph<T>(
  path: string,
  token: string,
  options: { method?: "GET" | "POST" | "DELETE"; query?: Query; body?: unknown; versioned?: boolean } = {},
): Promise<T> {
  const { graphVersion } = getInstagramConfig();
  const base = options.versioned === false ? GRAPH_HOST : `${GRAPH_HOST}/${graphVersion}`;
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const context = `${options.method ?? "GET"} ${path.split("?")[0]}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("INSTAGRAM_UNAVAILABLE", `instagram ${context}: network error or timeout`);
  }

  let payload: (T & { error?: GraphErrorBody }) | undefined;
  try {
    payload = (await response.json()) as T & { error?: GraphErrorBody };
  } catch {
    payload = undefined;
  }

  if (!response.ok || payload?.error) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw graphErrorToAppError(
      payload?.error,
      context,
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
    );
  }
  if (!payload) throw new AppError("INSTAGRAM_UNAVAILABLE", `instagram ${context}: non-JSON response`);
  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed wrappers
// ─────────────────────────────────────────────────────────────────────────────

export interface InstagramProfile {
  /** Instagram professional account ID — the ID webhooks use as `entry.id`. */
  userId: string;
  /** App-scoped user ID; deauthorize/data-deletion callbacks use this one. */
  appScopedId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  accountType: string | null;
}

export async function getMe(token: string): Promise<InstagramProfile> {
  const data = await callGraph<{
    user_id?: string;
    id: string;
    username: string;
    name?: string;
    profile_picture_url?: string;
    account_type?: string;
  }>("me", token, { query: { fields: "user_id,username,name,profile_picture_url,account_type" } });
  return {
    userId: data.user_id ?? data.id,
    appScopedId: data.id,
    username: data.username,
    name: data.name ?? null,
    profilePictureUrl: data.profile_picture_url ?? null,
    accountType: data.account_type ?? null,
  };
}

export const WEBHOOK_FIELDS = ["comments", "messages", "messaging_postbacks"] as const;

/** Subscribes this account to the app's webhook fields. Required per account. */
export async function subscribeApp(token: string): Promise<void> {
  await callGraph<{ success: boolean }>("me/subscribed_apps", token, {
    method: "POST",
    query: { subscribed_fields: WEBHOOK_FIELDS.join(",") },
  });
}

/**
 * Sends a DM. `recipient` is either `{ comment_id }` (a private reply — one per
 * comment, within 7 days) or `{ id }` (an IGSID inside the 24h messaging window).
 */
export async function sendMessage(
  token: string,
  recipient: { comment_id: string } | { id: string },
  message: OutgoingMessage,
): Promise<{ messageId: string | null }> {
  const data = await callGraph<{ recipient_id?: string; message_id?: string }>("me/messages", token, {
    method: "POST",
    body: { recipient, message },
  });
  return { messageId: data.message_id ?? null };
}

/** Public reply under a comment. */
export async function replyToComment(token: string, commentId: string, text: string): Promise<{ id: string }> {
  return callGraph<{ id: string }>(`${encodeURIComponent(commentId)}/replies`, token, {
    method: "POST",
    body: { message: text },
  });
}

export interface InstagramUserProfile {
  username: string | null;
  followsBusiness: boolean;
}

/**
 * Profile of someone who messaged the account. Only available after the person
 * has interacted (sent a message or tapped a button) — not from a comment alone.
 */
export async function getUserProfile(token: string, igsid: string): Promise<InstagramUserProfile> {
  const data = await callGraph<{ username?: string; is_user_follow_business?: boolean }>(
    encodeURIComponent(igsid),
    token,
    { query: { fields: "username,is_user_follow_business" } },
  );
  return { username: data.username ?? null, followsBusiness: data.is_user_follow_business === true };
}

export interface InstagramMedia {
  id: string;
  caption: string | null;
  mediaType: string;
  productType: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string;
}

export async function listMedia(token: string, limit = 24): Promise<InstagramMedia[]> {
  const data = await callGraph<{
    data: Array<{
      id: string;
      caption?: string;
      media_type: string;
      media_product_type?: string;
      media_url?: string;
      thumbnail_url?: string;
      permalink?: string;
      timestamp: string;
    }>;
  }>("me/media", token, {
    query: {
      fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp",
      limit,
    },
  });
  return data.data.map((item) => ({
    id: item.id,
    caption: item.caption ?? null,
    mediaType: item.media_type,
    productType: item.media_product_type ?? null,
    // Videos and reels expose a thumbnail; images only a media_url.
    thumbnailUrl: item.thumbnail_url ?? (item.media_type === "VIDEO" ? null : item.media_url ?? null),
    permalink: item.permalink ?? null,
    timestamp: item.timestamp,
  }));
}
