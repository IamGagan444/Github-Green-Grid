import Link from "next/link";
import { BellRing, Bot, GitCommitHorizontal, History, MessageCircle } from "lucide-react";

import { RunStatusBadge } from "@/components/status/status-badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/format";
import type { ActivityItem, ActivityKind } from "@/services/dashboard-service";

const KIND: Record<ActivityKind, { label: string; icon: typeof Bot }> = {
  STANDUP: { label: "Standup", icon: Bot },
  INSTAGRAM: { label: "Instagram", icon: MessageCircle },
  COMMIT: { label: "Commit activity", icon: GitCommitHorizontal },
  HUB: { label: "Notification hub", icon: BellRing },
};

/** Recent runs from every automation type, newest first. */
export function ActivityFeed({ items, timezone }: { items: ActivityItem[]; timezone: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Everything your automations did lately, in one place.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nothing has run yet"
            description="Standup posts, Instagram DMs and commit activity show up here as they happen."
            className="py-10"
          />
        ) : (
          <ul className="-mx-2 divide-y divide-border">
            {items.map((item) => {
              const kind = KIND[item.kind];
              const Icon = kind.icon;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/40">
                      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {kind.label}
                        {item.detail ? ` · ${item.detail}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <RunStatusBadge status={item.status} />
                      <span className="text-[11px] text-muted-foreground">{formatDateTime(item.at, timezone)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
