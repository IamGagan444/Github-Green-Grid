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
  return cached;
}

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
    nvidiaApi: has("NVIDIA_API_KEY"),
    cronSecret: has("CRON_SECRET"),
    encryptionKey: has("ENCRYPTION_KEY") || has("GITHUB_TOKEN_ENCRYPTION_KEY"),
    distributedRateLimit: has("UPSTASH_REDIS_REST_URL") && has("UPSTASH_REDIS_REST_TOKEN"),
  };
}
