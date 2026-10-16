import "server-only";

/**
 * Structured JSON logger.
 *
 * Every entry is one JSON line (level, message, timestamp, context) so log
 * drains can index fields. Context values are redacted twice before output:
 * keys that look credential-shaped are replaced outright, and string values
 * are scrubbed of anything matching a known token format. Callers should still
 * never pass secrets — the redaction is a safety net, not a licence.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|api[-_]?key|credential|private[-_]?key/i;

/** Formats of credentials this application handles. */
const TOKEN_PATTERNS: RegExp[] = [
  /xox[abposr]-[A-Za-z0-9-]+/g, // Slack
  /xoxe(?:\.xox[bp])?-[A-Za-z0-9-]+/g, // Slack refresh tokens
  /gh[opsur]_[A-Za-z0-9]{20,}/g, // GitHub
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /nvapi-[A-Za-z0-9_-]{10,}/g, // NVIDIA
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, // Telegram bot token
  /ya29\.[A-Za-z0-9_-]{20,}/g, // Google access token
  /\b1\/\/[A-Za-z0-9_-]{20,}/g, // Google refresh token
  /AIza[A-Za-z0-9_-]{30,}/g, // Google API key
  /\b(?:sk-or-v1-|sk-|gsk_)[A-Za-z0-9_-]{16,}/g, // OpenAI-compatible AI keys
  /(discord(?:app)?\.com\/api\/webhooks\/\d+\/)[A-Za-z0-9_-]+/g, // Discord webhook secret part
  /api\.telegram\.org\/bot[^/\s]+/g, // Bot API URLs embed the token
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/g, // our own ciphertext
];

export function redactString(value: string): string {
  let result = value;
  for (const pattern of TOKEN_PATTERNS) result = result.replace(pattern, "[REDACTED]");
  return result;
}

/** Personal data that has no place in operational logs (audit records keep their own fields). */
const PII_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]"],
  [/\+\d[\d\s-]{7,16}\d/g, "[PHONE]"],
];

export function redactPii(value: string): string {
  let result = value;
  for (const [pattern, replacement] of PII_PATTERNS) result = result.replace(pattern, replacement);
  return result;
}

/** Deep redaction for log output: credentials, then personal data. */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[Truncated]";
  if (typeof value === "string") return redactPii(redactString(value));
  if (value instanceof Error) return { name: value.name, message: redactPii(redactString(value.message)) };
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redactForLog(entry, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactForLog(entry, depth + 1);
    }
    return output;
  }
  return value;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[Truncated]";
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(entry, depth + 1);
    }
    return output;
  }
  return value;
}

function minimumLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured === "debug" || configured === "info" || configured === "warn" || configured === "error") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function write(level: LogLevel, scope: string, message: string, context?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel()]) return;
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    scope,
    message: redactPii(redactString(message)),
    ...(context ? { context: redactForLog(context) } : {}),
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, context) => write("debug", scope, message, context),
    info: (message, context) => write("info", scope, message, context),
    warn: (message, context) => write("warn", scope, message, context),
    error: (message, context) => write("error", scope, message, context),
  };
}
