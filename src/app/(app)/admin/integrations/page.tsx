import type { Metadata } from "next";
import Link from "next/link";

import { IntegrationBadge } from "@/components/status/status-badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listIntegrations } from "@/services/admin-service";

export const metadata: Metadata = { title: "Integrations · Admin" };
export const dynamic = "force-dynamic";

/** Integration status only. Tokens are never selected, let alone shown. */
export default async function AdminIntegrationsPage() {
  const admin = await requireAdmin("integration:read:all");
  const { github, slack } = await listIntegrations(admin);

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
      <section className="flex flex-col gap-3" aria-labelledby="github-heading">
        <h2 id="github-heading" className="text-sm font-medium">GitHub ({github.length})</h2>
        <div className="overflow-x-auto rounded-xl border border-border scrollbar-subtle">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>GitHub account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Connected</TableHead>
                <TableHead>Disconnected</TableHead>
                <TableHead>Token expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {github.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={`/admin/users/${row.user.id}`} className="hover:underline">
                      {row.user.email ?? row.user.name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell>@{row.username}</TableCell>
                  <TableCell>
                    <IntegrationBadge status={row.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(row.connectedAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.disconnectedAt ? formatDateTime(row.disconnectedAt) : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.tokenExpiresAt ? formatDateTime(row.tokenExpiresAt) : "Non-expiring"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="slack-heading">
        <h2 id="slack-heading" className="text-sm font-medium">Slack ({slack.length})</h2>
        <div className="overflow-x-auto rounded-xl border border-border scrollbar-subtle">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead className="text-right">Automations</TableHead>
                <TableHead>Connected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slack.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={`/admin/users/${row.user.id}`} className="hover:underline">
                      {row.user.email ?? row.user.name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.teamName} <span className="text-xs text-muted-foreground">{row.teamId}</span>
                  </TableCell>
                  <TableCell>
                    <IntegrationBadge status={row.status} />
                  </TableCell>
                  <TableCell className="max-w-72 text-xs text-muted-foreground">
                    bot: {row.botScopes.join(", ") || "—"}
                    {row.userScopes.length > 0 ? <><br />user: {row.userScopes.join(", ")}</> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row._count.automations}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(row.connectedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
