import "server-only";

import type { QuotaScope } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getQuotaCaps } from "@/lib/env";
import { quotaDay, reserveQuota, type QuotaStore, type Reservation } from "@/lib/quota/quota";
import { isWhatsAppConfigured } from "@/lib/whatsapp/client";

/** Postgres-backed quota counters; the WHERE clause makes each increment a compare-and-swap. */
export const prismaQuotaStore: QuotaStore = {
  async tryIncrement(scope, subject, day, units, cap) {
    if (units > cap) return false;
    await prisma.quotaUsage.createMany({ data: [{ scope, subject, day, used: 0 }], skipDuplicates: true });
    const { count } = await prisma.quotaUsage.updateMany({
      where: { scope, subject, day, used: { lte: cap - units } },
      data: { used: { increment: units } },
    });
    return count === 1;
  },

  async decrement(scope, subject, day, units) {
    await prisma.quotaUsage.updateMany({
      where: { scope, subject, day, used: { gte: units } },
      data: { used: { decrement: units } },
    });
  },

  async used(scope, subject, day) {
    const row = await prisma.quotaUsage.findUnique({
      where: { scope_subject_day: { scope, subject, day } },
      select: { used: true },
    });
    return row?.used ?? 0;
  },
};

export function reserve(scope: QuotaScope, userId: string, units: number, now = new Date()): Promise<Reservation> {
  return reserveQuota(prismaQuotaStore, { scope, userId, units, caps: getQuotaCaps()[scope], now });
}

export interface UsageMeter {
  scope: QuotaScope;
  label: string;
  used: number;
  cap: number;
}

const LABELS: Record<QuotaScope, string> = {
  YOUTUBE_UNITS: "YouTube API units today",
  EMAILS: "Emails sent today",
  TELEGRAM_MESSAGES: "Telegram messages today",
  WHATSAPP_MESSAGES: "WhatsApp messages today",
};

/** The user's usage of each metered quota, for the free-tier meters in the UI. */
export async function getUsageMeters(userId: string, now = new Date()): Promise<UsageMeter[]> {
  const caps = getQuotaCaps();
  // WhatsApp is optional; its meter only makes sense where it can be used.
  const scopes = (Object.keys(caps) as QuotaScope[]).filter((scope) => scope !== "WHATSAPP_MESSAGES" || isWhatsAppConfigured());
  return Promise.all(
    scopes.map(async (scope) => ({
      scope,
      label: LABELS[scope],
      used: await prismaQuotaStore.used(scope, userId, quotaDay(scope, now)),
      cap: caps[scope].user,
    })),
  );
}
