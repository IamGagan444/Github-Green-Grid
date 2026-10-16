/**
 * A tiny in-memory stand-in for the Prisma models used by ownership checks.
 * `where` is matched on plain equality of each scalar key (the only shape the
 * ownership lookups use), so a lookup scoped by `userId` behaves exactly as it
 * does in Postgres: another user's row is simply not found.
 */

type Row = Record<string, unknown> & { id: string };

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === "object") return true; // relation / operator filters are ignored
    return row[key] === value;
  });
}

export function scopedModel(rows: Row[]) {
  return {
    rows,
    findFirst: async (args: { where?: Record<string, unknown> } = {}) => rows.find((row) => matches(row, args.where)) ?? null,
    findUnique: async (args: { where: Record<string, unknown> }) => rows.find((row) => matches(row, args.where)) ?? null,
    findMany: async (args: { where?: Record<string, unknown> } = {}) => rows.filter((row) => matches(row, args.where)),
    count: async (args: { where?: Record<string, unknown> } = {}) => rows.filter((row) => matches(row, args.where)).length,
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows.find((entry) => matches(entry, args.where));
      if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" });
      Object.assign(row, args.data);
      return row;
    },
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows.filter((row) => matches(row, args.where));
      for (const row of hit) Object.assign(row, args.data);
      return { count: hit.length };
    },
    delete: async (args: { where: Record<string, unknown> }) => {
      const index = rows.findIndex((row) => matches(row, args.where));
      if (index === -1) throw Object.assign(new Error("Record not found"), { code: "P2025" });
      return rows.splice(index, 1)[0];
    },
    deleteMany: async (args: { where: Record<string, unknown> }) => {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) if (matches(rows[index]!, args.where)) rows.splice(index, 1);
      return { count: before - rows.length };
    },
  };
}
