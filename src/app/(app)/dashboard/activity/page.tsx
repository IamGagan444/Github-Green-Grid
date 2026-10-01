import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarCheck, CheckCircle2, Flame, History, XCircle } from "lucide-react";

import { ActivityFilters } from "@/components/activity/activity-filters";
import { ActivityTable } from "@/components/activity/activity-table";
import { CalendarPanel } from "@/components/dashboard/calendar-panel";
import { RunNowButton } from "@/components/dashboard/run-now-button";
import { StatsCard } from "@/components/dashboard/stats-card";
import { UpcomingActivity } from "@/components/dashboard/upcoming-activity";
import { GitHubRequiredNotice } from "@/components/integrations/github-required-notice";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ActivityTableSkeleton, CalendarSkeleton, StatsSkeleton } from "@/components/ui/skeletons";
import { getCalendarData } from "@/lib/activity/calendar";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActivityHistory } from "@/lib/services/activity-history";
import { listStoredRepositories } from "@/lib/services/repositories";
import { listSchedules } from "@/lib/services/schedules";
import { activityQuerySchema } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Commit activity" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;

  const [preferences, schedules] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { defaultTimezone: true } }),
    listSchedules(user.userId),
  ]);
  const timezone = schedules[0]?.timezone ?? preferences.defaultTimezone;
  const primarySchedule = schedules.find((schedule) => schedule.enabled) ?? schedules[0] ?? null;

  return (
    <>
      <Header
        title="Commit activity"
        description="Scheduled repository maintenance and every execution's result."
        actions={
          primarySchedule ? (
            <RunNowButton
              scheduleId={primarySchedule.id}
              repositoryFullName={primarySchedule.repository.fullName}
            />
          ) : (
            <Button asChild>
              <Link href="/dashboard/schedule">Create schedule</Link>
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        <GitHubRequiredNotice userId={user.userId} returnTo="/dashboard/activity" />

        <Suspense fallback={<StatsSkeleton />}>
          <OverviewStats userId={user.userId} timezone={timezone} />
        </Suspense>

        <Suspense fallback={<CalendarSkeleton />}>
          <OverviewCalendar userId={user.userId} timezone={timezone} />
        </Suspense>

        <UpcomingActivity schedules={schedules} />

        <Suspense fallback={<ActivityTableSkeleton />}>
          <ActivityContent userId={user.userId} params={params} />
        </Suspense>
      </div>
    </>
  );
}

async function OverviewStats({ userId, timezone }: { userId: string; timezone: string }) {
  const { stats } = await getCalendarData(userId, timezone);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatsCard
        label="Current streak"
        value={stats.currentStreak}
        hint={stats.currentStreak === 1 ? "day" : "days"}
        icon={Flame}
        tone="success"
      />
      <StatsCard label="Scheduled this week" value={stats.scheduledThisWeek} hint="planned runs" icon={CalendarCheck} />
      <StatsCard label="Completed" value={stats.completed} hint="last 12 months" icon={CheckCircle2} tone="success" />
      <StatsCard
        label="Failed"
        value={stats.failed}
        hint="last 12 months"
        icon={XCircle}
        tone={stats.failed > 0 ? "destructive" : "default"}
      />
    </div>
  );
}

async function OverviewCalendar({ userId, timezone }: { userId: string; timezone: string }) {
  const calendar = await getCalendarData(userId, timezone);
  return (
    <CalendarPanel
      startDate={calendar.startDate}
      endDate={calendar.endDate}
      days={calendar.days}
      timezone={timezone}
    />
  );
}

async function ActivityContent({
  userId,
  params,
}: {
  userId: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const repositories = await listStoredRepositories(userId);

  // Invalid query strings fall back to defaults rather than erroring the page.
  const parsed = activityQuerySchema.safeParse(params);
  const query = parsed.success ? parsed.data : activityQuerySchema.parse({});

  const history = await getActivityHistory(userId, query);

  return (
    <>
      <ActivityFilters
        repositories={repositories.map((repository) => ({
          id: repository.id,
          fullName: repository.fullName,
        }))}
      />

      {history.rows.length === 0 ? (
        <EmptyState
          icon={History}
          title="No automated activity yet."
          description="Once a schedule runs, every execution is recorded here with its commit."
          action={
            <Button asChild>
              <Link href="/dashboard/schedule">Create your first schedule</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ActivityTable rows={history.rows} />
          <Pagination
            basePath="/dashboard/activity"
            params={params}
            page={history.page}
            total={history.total}
            pageSize={query.pageSize}
            noun="executions"
          />
        </>
      )}
    </>
  );
}
