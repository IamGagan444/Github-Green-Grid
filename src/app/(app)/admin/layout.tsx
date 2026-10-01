import type { ReactNode } from "react";

import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Every /admin page is gated here on the server (non-admins get a 404), and
 * each admin service call re-checks the specific permission it needs.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <>
      <div className="border-b border-border bg-card/30 px-4 pt-5 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">Administration</h1>
        <p className="mt-0.5 pb-1 text-sm text-muted-foreground">Users, automations, executions and system health.</p>
      </div>
      <AdminNav />
      {children}
    </>
  );
}
