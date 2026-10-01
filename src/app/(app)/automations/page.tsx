import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Plus } from "lucide-react";

import { AutomationCard } from "@/components/automations/automation-card";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { listAutomationsForUser } from "@/services/automation-service";

export const metadata: Metadata = { title: "Standup automations" };
export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const user = await requireUser("automation:read:own");
  const automations = await listAutomationsForUser(user.userId);

  return (
    <>
      <Header
        title="Standup automations"
        description="Each automation turns your commits into a daily Slack update on its own schedule."
        actions={
          <Button asChild>
            <Link href="/automations/new">
              <Plus aria-hidden="true" />
              Create automation
            </Link>
          </Button>
        }
      />

      <div className="px-4 py-6 sm:px-6">
        {automations.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No automations yet"
            description="Create one to post an AI-written standup from your GitHub commits to Slack every day."
            action={
              <Button asChild>
                <Link href="/automations/new">Create your first automation</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {automations.map((automation) => (
              <AutomationCard key={automation.id} automation={automation} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
