import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutomationWizard } from "@/components/automations/automation-wizard";
import { Header } from "@/components/layout/header";
import { requireUser } from "@/lib/auth";
import { AuthorizationError } from "@/lib/rbac";
import { idParamSchema } from "@/validators/automation";
import { getAutomationForActor } from "@/services/automation-service";
import { loadWizardContext } from "../../wizard-context";

export const metadata: Metadata = { title: "Edit automation" };
export const dynamic = "force-dynamic";

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("automation:update:own");
  const parsed = idParamSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  let automation;
  try {
    automation = await getAutomationForActor(user, parsed.data);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  // Editing is owner-only, even for admins.
  if (automation.userId !== user.userId) notFound();

  const context = await loadWizardContext(user.userId);

  return (
    <>
      <Header
        title={`Edit ${automation.name}`}
        description="Changes apply from the next run. History is not affected."
        back={{ href: `/automations/${automation.id}`, label: automation.name }}
      />
      <div className="px-4 py-6 sm:px-6">
        <AutomationWizard
          mode="edit"
          automationId={automation.id}
          {...context}
          initialValues={{
            name: automation.name,
            githubSources: automation.githubSources.map(({ repositoryId, owner, name, branch }) => ({
              repositoryId,
              owner,
              name,
              branch,
            })),
            commitWindow: automation.commitWindow,
            messageStyle: automation.messageStyle,
            quickNote: automation.quickNote ?? "",
            includeFileStats: automation.includeFileStats,
            slackIntegrationId: automation.slackIntegrationId ?? "",
            slackChannelId: automation.slackChannelId,
            slackChannelName: automation.slackChannelName,
            postingMode: automation.postingMode,
            threadMode: automation.threadMode,
            headerFormat: automation.headerFormat,
            daysOfWeek: automation.daysOfWeek,
            scheduleTime: automation.scheduleTime,
            timezone: automation.timezone,
          }}
        />
      </div>
    </>
  );
}
