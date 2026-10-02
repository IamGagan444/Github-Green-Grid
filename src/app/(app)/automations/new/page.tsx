import type { Metadata } from "next";

import { AutomationWizard } from "@/components/automations/automation-wizard";
import { Header } from "@/components/layout/header";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadWizardContext } from "../wizard-context";

export const metadata: Metadata = { title: "New automation" };
export const dynamic = "force-dynamic";

export default async function NewAutomationPage() {
  const user = await requireUser("automation:create:own");
  const [context, defaults] = await Promise.all([
    loadWizardContext(user.userId),
    prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { defaultTimezone: true, defaultScheduleTime: true, defaultDaysOfWeek: true, defaultMessageStyle: true },
    }),
  ]);

  const firstWorkspace = context.workspaces.find((workspace) => workspace.status === "CONNECTED");

  return (
    <>
      <Header
        title="Create automation"
        description="Eight short steps. You can test with real data before saving."
        back={{ href: "/automations", label: "Automations" }}
      />
      <div className="px-4 py-6 sm:px-6">
        <AutomationWizard
          mode="create"
          {...context}
          initialValues={{
            name: "",
            githubSources: [],
            commitWindow: "SAME_DAY",
            messageStyle: defaults.defaultMessageStyle,
            quickNote: "",
            includeFileStats: false,
            slackIntegrationId: firstWorkspace?.id ?? "",
            slackChannelId: "",
            slackChannelName: "",
            postingMode: "BOT",
            threadMode: "DATE_HEADER",
            headerFormat: "📅 {date}",
            daysOfWeek: defaults.defaultDaysOfWeek,
            scheduleTimes: [defaults.defaultScheduleTime],
            timezone: defaults.defaultTimezone,
          }}
        />
      </div>
    </>
  );
}
