import "server-only";

import { safeCompare } from "@/lib/encryption";
import { getEnv } from "@/lib/env";

/**
 * Cron endpoints accept only `Authorization: Bearer <CRON_SECRET>`, compared
 * in constant time. Vercel Cron sends exactly this header when CRON_SECRET is
 * set; external schedulers (GitHub Actions) send it explicitly.
 */
export function readBearer(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header) return null;
  const [scheme, value, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value || rest.length > 0) return null;
  return value;
}

export function isCronAuthorised(headers: Headers): boolean {
  const provided = readBearer(headers);
  if (!provided) return false;
  return safeCompare(getEnv().CRON_SECRET, provided);
}
