import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarCheck, CheckCircle2, Flame, XCircle } from "lucide-react";

import { CalendarPanel } from "@/components/dashboard/calendar-panel";
import { ContributionDisclaimer } from "@/components/dashboard/contribution-disclaimer";
import { RunNowButton } from "@/components/dashboard/run-now-button";
import { StatsCard } from "@/components/dashboard/stats-card";
import { UpcomingActivity } from "@/components/dashboard/upcoming-activity";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { CalendarSkeleton, StatsSkeleton } from "@/components/ui/skeletons";
import { getCalendarData } from "@/lib/activity/calendar";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { greetingFor } from "@/lib/format";
import { listSchedules } from "@/lib/services/schedules";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireSessionUser();

  const [preferences, schedules] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { defaultTimezone: true },
    }),
    listSchedules(user.userId),
  ]);

  // The first schedule's timezone is the user's working timezone; fall back to
  // their configured default when no schedule exists yet.
  const timezone = schedules[0]?.timezone ?? preferences.defaultTimezone;
  const primarySchedule = schedules.find((schedule) => schedule.enabled) ?? schedules[0] ?? null;

  return (
    <>
      <Header
        title={greetingFor(new Date(), timezone) + ", " + user.username}
        description="Here's your GitHub activity overview."
        profile={{
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        }}
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
        <Suspense fallback={<StatsSkeleton />}>
          <OverviewStats userId={user.userId} timezone={timezone} />
        </Suspense>

        <Suspense fallback={<CalendarSkeleton />}>
          <OverviewCalendar userId={user.userId} timezone={timezone} />
        </Suspense>

        <div className="grid gap-5 lg:grid-cols-2">
          <UpcomingActivity schedules={schedules} />
          <ContributionDisclaimer />
        </div>
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
      <StatsCard
        label="Scheduled this week"
        value={stats.scheduledThisWeek}
        hint="planned runs"
        icon={CalendarCheck}
      />
      <StatsCard
        label="Completed"
        value={stats.completed}
        hint="last 12 months"
        icon={CheckCircle2}
        tone="success"
      />
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
