import { z } from "zod";

/**
 * Server-only environment contract. Importing this module from a client
 * component is a build error by design (`server-only`).
 */
import "server-only";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url(),

  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),

  // 32 bytes, base64 encoded. See `lib/encryption.ts`.
  GITHUB_TOKEN_ENCRYPTION_KEY: z.string().min(32),

  CRON_SECRET: z.string().min(16),

  NEXT_PUBLIC_APP_URL: z.string().url(),

  // Optional Upstash Redis for distributed rate limiting.
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
