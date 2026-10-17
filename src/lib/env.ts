import { z } from "zod";

/**
 * Server-only environment contract. Importing this module from a client
 * component is a build error by design (`server-only`).
 */
import "server-only";

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const serverEnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    NEXT_PUBLIC_APP_URL: z.string().url(),

    // Auth.js
    AUTH_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),

    // GitHub App (user-to-server OAuth).
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    // Optional: enables the "Manage repository access" link to the App install page.
    GITHUB_APP_SLUG: optionalString,

    // 32 bytes, base64 encoded. See `lib/encryption.ts`. The legacy name is
    // accepted so existing deployments keep decrypting stored credentials.
    ENCRYPTION_KEY: optionalString,
    GITHUB_TOKEN_ENCRYPTION_KEY: optionalString,

    CRON_SECRET: z.string().min(16),

    // Optional Upstash Redis for distributed rate limiting.
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .refine((env) => Boolean(env.ENCRYPTION_KEY ?? env.GITHUB_TOKEN_ENCRYPTION_KEY), {
    message: "ENCRYPTION_KEY is required",
    path: ["ENCRYPTION_KEY"],
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Parses and caches server environment variables.
 * Throws a redacted error listing missing/invalid keys — never their values.
 */
export function getEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${keys}`);
  }

  cached = parsed.data;
  if (cached.CRON_SECRET.length < RECOMMENDED_SECRET_LENGTH) {
    // Not fatal, so an existing deployment keeps running until the secret is rotated.
    console.warn(
      JSON.stringify({
        level: "warn",
        scope: "env",
        message: `CRON_SECRET is shorter than ${RECOMMENDED_SECRET_LENGTH} characters; rotate it (openssl rand -base64 32).`,
      }),
    );
  }
  return cached;
}

/** Secrets shorter than this trigger a startup warning. */
export const RECOMMENDED_SECRET_LENGTH = 32;

export function getAppUrl(): string {
  return getEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature configuration. Slack and NVIDIA are validated lazily so the rest of
// the application keeps working while an integration is being configured.
// ─────────────────────────────────────────────────────────────────────────────

export class ConfigurationError extends Error {
  readonly keys: string[];

  constructor(feature: string, keys: string[]) {
    super(`${feature} is not configured: missing ${keys.join(", ")}`);
    this.name = "ConfigurationError";
    this.keys = keys;
  }
}

const DEFAULT_SLACK_BOT_SCOPES = [
  "chat:write",
  "channels:read",
  "groups:read",
  "channels:history",
  "groups:history",
  "channels:join",
];

/** "Post as me": the user's own token posts, and reads the thread to avoid duplicates. */
const DEFAULT_SLACK_USER_SCOPES = [
  "chat:write",
  "channels:read",
  "groups:read",
  "channels:history",
  "groups:history",
];

export interface SlackConfig {
  clientId: string;
  clientSecret: string;
  signingSecret: string | null;
  botScopes: string[];
  /** Empty when "Post as me" is switched off (SLACK_USER_SCOPES=none). */
  userScopes: string[];
}

function parseScopes(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return fallback;
  if (raw.toLowerCase() === "none") return [];
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function getSlackConfig(): SlackConfig {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  const missing = [
    ...(clientId ? [] : ["SLACK_CLIENT_ID"]),
    ...(clientSecret ? [] : ["SLACK_CLIENT_SECRET"]),
  ];
  if (missing.length > 0 || !clientId || !clientSecret) {
    throw new ConfigurationError("Slack", missing);
  }

  return {
    clientId,
    clientSecret,
    signingSecret: process.env.SLACK_SIGNING_SECRET?.trim() || null,
    botScopes: parseScopes(process.env.SLACK_BOT_SCOPES?.trim() || undefined, DEFAULT_SLACK_BOT_SCOPES),
    userScopes: parseScopes(process.env.SLACK_USER_SCOPES?.trim() || undefined, DEFAULT_SLACK_USER_SCOPES),
  };
}

export interface InstagramConfig {
  appId: string;
  appSecret: string;
  /** Echoed back by Meta's webhook verification handshake. */
  webhookVerifyToken: string | null;
  graphVersion: string;
  scopes: string[];
}

const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
];

export function getInstagramConfig(): InstagramConfig {
  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
  const missing = [
    ...(appId ? [] : ["INSTAGRAM_APP_ID"]),
    ...(appSecret ? [] : ["INSTAGRAM_APP_SECRET"]),
  ];
  if (missing.length > 0 || !appId || !appSecret) {
    throw new ConfigurationError("Instagram", missing);
  }

  return {
    appId,
    appSecret,
    webhookVerifyToken: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() || null,
    graphVersion: process.env.INSTAGRAM_GRAPH_VERSION?.trim() || "v25.0",
    scopes: INSTAGRAM_SCOPES,
  };
}

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getAiConfig(): AiConfig {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) throw new ConfigurationError("NVIDIA AI", ["NVIDIA_API_KEY"]);

  return {
    apiKey,
    baseUrl: (process.env.NVIDIA_BASE_URL?.trim() || "https://integrate.api.nvidia.com/v1").replace(
      /\/$/,
      "",
    ),
    model: process.env.NVIDIA_MODEL?.trim() || "nvidia/nemotron-3-super-120b-a12b",
  };
}

/** True when no production deployment would use this process (dev and test). */
export function isNonProductionRuntime(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** The platform AI key, or null. Used for new automations only outside production. */
export function getPlatformAiConfig(): AiConfig | null {
  try {
    return getAiConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) return null;
    throw error;
  }
}

export interface TelegramConfig {
  botToken: string;
  /** Without the leading @. */
  botUsername: string;
  /** Echoed by Telegram in X-Telegram-Bot-Api-Secret-Token on every webhook call. */
  webhookSecret: string;
}

export function getTelegramConfig(): TelegramConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const missing = [
    ...(botToken ? [] : ["TELEGRAM_BOT_TOKEN"]),
    ...(botUsername ? [] : ["TELEGRAM_BOT_USERNAME"]),
    ...(webhookSecret ? [] : ["TELEGRAM_WEBHOOK_SECRET"]),
  ];
  if (!botToken || !botUsername || !webhookSecret) throw new ConfigurationError("Telegram", missing);
  return { botToken, botUsername, webhookSecret };
}

/**
 * LinkedIn app with "Sign In with LinkedIn using OpenID Connect" and
 * "Share on LinkedIn" products. Optional: without it the cross-poster can
 * still announce on the user's own channels.
 */
export function getLinkedInConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new ConfigurationError("LinkedIn", [...(clientId ? [] : ["LINKEDIN_CLIENT_ID"]), ...(clientSecret ? [] : ["LINKEDIN_CLIENT_SECRET"])]);
  }
  return { clientId, clientSecret };
}

export interface WhatsAppConfig {
  /** Permanent system-user token from Meta Business settings. Sent only in the Authorization header. */
  accessToken: string;
  phoneNumberId: string;
  /** The business number users message to link their phone, E.164 without spaces. */
  businessNumber: string;
  /** Verifies X-Hub-Signature-256 on webhook deliveries. */
  appSecret: string;
  /** Echoed back during Meta's webhook subscription handshake. */
  webhookVerifyToken: string;
  /** Approved utility template with two body parameters: {{1}} title, {{2}} details. */
  templateName: string;
  templateLanguage: string;
  graphVersion: string;
}

/**
 * WhatsApp Cloud API. Optional: business-initiated messages are billed by
 * Meta per message, so the channel only appears when an operator configures it.
 */
export function getWhatsAppConfig(): WhatsAppConfig {
  const read = (key: string) => process.env[key]?.trim() || undefined;
  const accessToken = read("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = read("WHATSAPP_PHONE_NUMBER_ID");
  const businessNumber = read("WHATSAPP_BUSINESS_NUMBER")?.replace(/[\s-]/g, "");
  const appSecret = read("WHATSAPP_APP_SECRET");
  const webhookVerifyToken = read("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  const required = { WHATSAPP_ACCESS_TOKEN: accessToken, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId, WHATSAPP_BUSINESS_NUMBER: businessNumber, WHATSAPP_APP_SECRET: appSecret, WHATSAPP_WEBHOOK_VERIFY_TOKEN: webhookVerifyToken };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0 || !accessToken || !phoneNumberId || !businessNumber || !appSecret || !webhookVerifyToken) {
    throw new ConfigurationError("WhatsApp", missing);
  }
  if (!/^\+[1-9]\d{6,14}$/.test(businessNumber)) {
    throw new ConfigurationError("WhatsApp", ["WHATSAPP_BUSINESS_NUMBER (E.164, e.g. +919876543210)"]);
  }
  return {
    accessToken,
    phoneNumberId,
    businessNumber,
    appSecret,
    webhookVerifyToken,
    templateName: read("WHATSAPP_TEMPLATE_NAME") ?? "greengrid_alert",
    templateLanguage: read("WHATSAPP_TEMPLATE_LANGUAGE") ?? "en",
    graphVersion: read("WHATSAPP_GRAPH_VERSION") ?? "v21.0",
  };
}

/** Secret configured on the GitHub App's webhook; verifies X-Hub-Signature-256. */
export function getGitHubWebhookSecret(): string {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) throw new ConfigurationError("GitHub webhook", ["GITHUB_WEBHOOK_SECRET"]);
  return secret;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Daily caps on shared free-tier quotas. Overridable for self-hosters. */
export function getQuotaCaps() {
  return {
    YOUTUBE_UNITS: {
      user: positiveInt(process.env.QUOTA_YOUTUBE_UNITS_PER_USER, 200),
      global: positiveInt(process.env.QUOTA_YOUTUBE_UNITS_GLOBAL, 9_000),
    },
    EMAILS: { user: positiveInt(process.env.QUOTA_EMAILS_PER_USER, 100), global: null },
    TELEGRAM_MESSAGES: { user: positiveInt(process.env.QUOTA_TELEGRAM_PER_USER, 300), global: null },
    // Paid per message, so both caps are deliberately low and operator-tunable.
    WHATSAPP_MESSAGES: {
      user: positiveInt(process.env.QUOTA_WHATSAPP_PER_USER, 20),
      global: positiveInt(process.env.QUOTA_WHATSAPP_GLOBAL, 500),
    },
  } as const;
}

/** Presence (never values) of each configurable area, for the admin system page. */
export function getConfigurationStatus(): Record<string, boolean> {
  const has = (key: string) => Boolean(process.env[key]?.trim());
  return {
    database: has("DATABASE_URL"),
    authSecret: has("AUTH_SECRET"),
    googleOAuth: has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET"),
    githubApp: has("GITHUB_CLIENT_ID") && has("GITHUB_CLIENT_SECRET"),
    slackOAuth: has("SLACK_CLIENT_ID") && has("SLACK_CLIENT_SECRET"),
    slackSigningSecret: has("SLACK_SIGNING_SECRET"),
    slackUserPosting: process.env.SLACK_USER_SCOPES?.trim().toLowerCase() !== "none",
    instagramApp: has("INSTAGRAM_APP_ID") && has("INSTAGRAM_APP_SECRET"),
    instagramWebhook: has("INSTAGRAM_WEBHOOK_VERIFY_TOKEN"),
    nvidiaApi: has("NVIDIA_API_KEY"),
    telegramBot: has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_BOT_USERNAME") && has("TELEGRAM_WEBHOOK_SECRET"),
    githubWebhook: has("GITHUB_WEBHOOK_SECRET"),
    linkedIn: has("LINKEDIN_CLIENT_ID") && has("LINKEDIN_CLIENT_SECRET"),
    whatsApp:
      has("WHATSAPP_ACCESS_TOKEN") &&
      has("WHATSAPP_PHONE_NUMBER_ID") &&
      has("WHATSAPP_BUSINESS_NUMBER") &&
      has("WHATSAPP_APP_SECRET") &&
      has("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
    cronSecret: has("CRON_SECRET"),
    encryptionKey: has("ENCRYPTION_KEY") || has("GITHUB_TOKEN_ENCRYPTION_KEY"),
    distributedRateLimit: has("UPSTASH_REDIS_REST_URL") && has("UPSTASH_REDIS_REST_TOKEN"),
  };
}
