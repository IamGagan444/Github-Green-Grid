import { PrismaPg } from "@prisma/adapter-pg";
import "server-only";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 connects through a driver adapter. A single client is cached on
 * globalThis in development so hot reloads do not exhaust the connection pool.
 */

const globalForPrisma = globalThis as unknown as {
  greengridPrisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Prisma's 5s default is tight for a pooled remote database (Neon/Supabase),
    // where each statement in a transaction is a separate round-trip.
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
}

export const prisma: PrismaClient = globalForPrisma.greengridPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.greengridPrisma = prisma;
}
