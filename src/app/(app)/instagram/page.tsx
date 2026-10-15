import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, Plus } from "lucide-react";

import { InstagramIcon } from "@/components/icons/instagram-icon";
import { Header } from "@/components/layout/header";
import { AutomationStatusBadge } from "@/components/status/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { listInstagramAutomations } from "@/services/instagram-automation-service";
import { listInstagramIntegrations } from "@/services/instagram-service";

export const metadata: Metadata = { title: "Instagram automations" };
export const dynamic = "force-dynamic";

const TRIGGER_LABELS = {
  COMMENT: "Comment",
  DM_KEYWORD: "DM keyword",
  STORY_REPLY: "Story reply",
  STORY_MENTION: "Story mention",
} as const;

export default async function InstagramAutomationsPage() {
  const user = await requireUser("automation:read:own");
  const [automations, accounts] = await Promise.all([
    listInstagramAutomations(user.userId),
    listInstagramIntegrations(user.userId),
  ]);
  const connected = accounts.some((account) => account.status === "CONNECTED");

  return (
    <>
      <Header
        title="Instagram automations"
        description="Auto-DM a link when someone comments or messages a keyword."
        actions={
          connected ? (
            <Button asChild>
              <Link href="/instagram/new">
                <Plus aria-hidden="true" />
                Create automation
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="px-4 py-6 sm:px-6">
        {!connected ? (
          <EmptyState
            icon={MessageCircle}
            title="Connect Instagram first"
            description="Connect an Instagram Business or Creator account to start replying to comments and DMs automatically."
            action={
              <Button asChild>
                <a href="/api/integrations/instagram/connect?returnTo=/instagram">
                  <InstagramIcon className="size-4" />
                  Connect Instagram
                </a>
              </Button>
            }
          />
        ) : automations.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="No Instagram automations yet"
            description="Example: when someone comments “LINK” on your reel, DM them the link and reply “Sent! Check your DMs”."
            action={
              <Button asChild>
                <Link href="/instagram/new">Create your first automation</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {automations.map((automation) => (
              <Link key={automation.id} href={`/instagram/${automation.id}`} className="group">
                <Card className="h-full transition-colors group-hover:border-primary/50">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="truncate">{automation.name}</CardTitle>
                      <AutomationStatusBadge status={automation.status} />
                    </div>
                    <CardDescription>
                      {TRIGGER_LABELS[automation.trigger]} · @{automation.integration.username}
                      {automation.keywords.length > 0 ? ` · “${automation.keywords.slice(0, 3).join("”, “")}”` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-3 gap-2 text-center">
                    <Stat label="Triggered" value={automation.triggeredCount} />
                    <Stat label="DMs sent" value={automation.sentCount} />
                    <Stat label="Link clicks" value={automation.clickCount} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-secondary/60 px-2 py-2">
      <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
