import "server-only";

import { prisma } from "@/lib/db";

/** Removes expired sessions. Called opportunistically from the cron endpoint. */
export async function pruneExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

/** Signs a user out everywhere — used when an account is disabled. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}
