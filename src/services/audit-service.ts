import "server-only";

import { prisma } from "@/lib/db";
import { createLogger, redact } from "@/lib/logging/logger";
import type { AuditAction } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

const log = createLogger("audit");

const MAX_METADATA_BYTES = 4_000;

export interface AuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Strips credential-shaped keys and token-looking values, then bounds the size.
 * Exported for tests: audit metadata must never contain secrets.
 */
export function sanitiseAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;
  const cleaned = redact(metadata) as Record<string, unknown>;
  const serialised = JSON.stringify(cleaned);
  if (serialised.length <= MAX_METADATA_BYTES) return cleaned as Prisma.InputJsonValue;
  return { truncated: true } as Prisma.InputJsonValue;
}

/**
 * Appends an audit record. Auditing must never break the operation it
 * describes, so failures are logged and swallowed.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        metadata: sanitiseAuditMetadata(entry.metadata),
      },
    });
  } catch (error) {
    log.error("failed to write audit log", { action: entry.action, error: error as Error });
  }
}

export interface AuditQuery {
  actorUserId?: string;
  action?: AuditAction;
  page: number;
  pageSize: number;
}

export async function listAuditLogs(query: AuditQuery) {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.action ? { action: query.action } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, total };
}
