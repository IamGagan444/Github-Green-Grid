import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InstagramAutomationForm } from "@/components/instagram/instagram-automation-form";
import { Header } from "@/components/layout/header";
import { requireUser } from "@/lib/auth";
import { AuthorizationError } from "@/lib/rbac";
import { getInstagramAutomation } from "@/services/instagram-automation-service";
import { listInstagramIntegrations } from "@/services/instagram-service";

export const metadata: Metadata = { title: "Edit Instagram automation" };
export const dynamic = "force-dynamic";

export default async function EditInstagramAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("automation:update:own");
  const { id } = await params;

  const automation = await getInstagramAutomation(user, id).catch((error: unknown) => {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  });
  const accounts = await listInstagramIntegrations(user.userId);

  return (
    <>
      <Header title={`Edit “${automation.name}”`} back={{ href: `/instagram/${id}`, label: automation.name }} />
      <div className="px-4 py-6 sm:px-6">
        <InstagramAutomationForm
          automationId={id}
          accounts={accounts.map((account) => ({ id: account.id, username: account.username }))}
          initial={{
            integrationId: automation.integrationId,
            name: automation.name,
            trigger: automation.trigger,
            mediaIds: automation.mediaIds,
            matchMode: automation.matchMode,
            keywords: automation.keywords,
            publicReplyEnabled: automation.publicReplyEnabled,
            publicReplies: automation.publicReplies,
            dmMessage: automation.dmMessage,
            linkUrl: automation.linkUrl,
            linkButtonLabel: automation.linkButtonLabel,
            followGateEnabled: automation.followGateEnabled,
            followGateMessage: automation.followGateMessage,
            followButtonLabel: automation.followButtonLabel,
          }}
        />
      </div>
    </>
  );
}
