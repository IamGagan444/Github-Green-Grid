import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { z } from "zod";

import { UserStatusControl } from "@/components/admin/user-status-control";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { listUsers } from "@/services/admin-service";

export const metadata: Metadata = { title: "Users · Admin" };
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});

const PAGE_SIZE = 25;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin("user:read:all");
  const params = await searchParams;
  const parsed = querySchema.safeParse(params);
  const query = parsed.success ? parsed.data : querySchema.parse({});

  const { items, total } = await listUsers(admin, {
    search: query.q || undefined,
    status: query.status,
    page: query.page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
      <form className="flex max-w-md gap-2" role="search">
        <input
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="Search name or email"
          aria-label="Search users"
          className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm hover:bg-secondary">
          Search
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState icon={Users} title="No users found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border scrollbar-subtle">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Automations</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Link href={`/admin/users/${user.id}`} className="font-medium hover:underline">
                      {user.name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.email ?? "legacy account"}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === "ADMIN" ? "warning" : "outline"}>{user.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.status === "ACTIVE" ? "success" : "destructive"}>{user.status}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(user.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}</TableCell>
                  <TableCell className="text-right tabular-nums">{user._count.automations}</TableCell>
                  <TableCell className="text-right">
                    {user.id === admin.userId ? (
                      <span className="text-xs text-muted-foreground">You</span>
                    ) : (
                      <UserStatusControl userId={user.id} label={user.email ?? user.name ?? "this user"} status={user.status} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination basePath="/admin/users" params={params} page={query.page} total={total} pageSize={PAGE_SIZE} noun="users" />
    </div>
  );
}
