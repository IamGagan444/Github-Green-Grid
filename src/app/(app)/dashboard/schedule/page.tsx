import type { Metadata } from "next";
import { Suspense } from "react";

import { ContributionDisclaimer } from "@/components/dashboard/contribution-disclaimer";
import { GitHubRequiredNotice } from "@/components/integrations/github-required-notice";
import { Header } from "@/components/layout/header";
import { ScheduleManager } from "@/components/schedule/schedule-manager";
import { ScheduleSkeleton } from "@/components/ui/skeletons";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listSupportedTimezones } from "@/lib/schedule/timezone";
import { listStoredRepositories } from "@/lib/services/repositories";
import { listSchedules } from "@/lib/services/schedules";

export const metadata: Metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const user = await requireUser();

  return (
    <>
      <Header
        title="Schedule"
        description="Decide when GreenGrid performs repository maintenance for you."
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        <GitHubRequiredNotice userId={user.userId} returnTo="/dashboard/schedule" />

        <Suspense fallback={<ScheduleSkeleton />}>
          <ScheduleContent userId={user.userId} />
        </Suspense>

        <ContributionDisclaimer />
      </div>
    </>
  );
}

async function ScheduleContent({ userId }: { userId: string }) {
  const [schedules, repositories, preferences] = await Promise.all([
    listSchedules(userId),
    listStoredRepositories(userId),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { defaultTimezone: true, defaultCommitMessage: true },
    }),
  ]);

  const selected = repositories.find((repository) => repository.selected) ?? null;

  return (
    <ScheduleManager
      schedules={schedules}
      repositories={repositories.map((repository) => ({
        id: repository.id,
        fullName: repository.fullName,
        archived: repository.archived,
        canPush: repository.canPush,
      }))}
      timezones={listSupportedTimezones()}
      defaults={{
        timezone: preferences.defaultTimezone,
        commitMessage: preferences.defaultCommitMessage,
        repositoryId: selected?.id ?? null,
      }}
    />
  );
}
