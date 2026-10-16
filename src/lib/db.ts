import { PrismaPg } from "@prisma/adapter-pg";
import "server-only";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 connects through a driver adapter. One client is cached on
 * globalThis per process: in development so hot reloads do not exhaust the
 * pool, and in production so every module in a warm serverless instance shares
 * one small pool.
 *
 * Serverless instances multiply connections, so the pool is kept small
 * (DATABASE_POOL_MAX, default 3). On Neon, point DATABASE_URL at the pooled
 * ("-pooler") host so PgBouncer absorbs bursts.
 */

const globalForPrisma = globalThis as unknown as {
  greengridPrisma: PrismaClient | undefined;
};

function poolMax(): number {
  const value = Number(process.env.DATABASE_POOL_MAX);
  return Number.isInteger(value) && value > 0 && value <= 50 ? value : 3;
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: poolMax(), idleTimeoutMillis: 10_000 }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Prisma's 5s default is tight for a pooled remote database (Neon/Supabase),
    // where each statement in a transaction is a separate round-trip.
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
}

export const prisma: PrismaClient = globalForPrisma.greengridPrisma ?? createClient();

globalForPrisma.greengridPrisma = prisma;
