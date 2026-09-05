import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { History } from "lucide-react";

import { ActivityFilters } from "@/components/activity/activity-filters";
import { ActivityTable } from "@/components/activity/activity-table";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ActivityTableSkeleton } from "@/components/ui/skeletons";
import { requireSessionUser } from "@/lib/auth";
import { getActivityHistory } from "@/lib/services/activity-history";
import { listStoredRepositories } from "@/lib/services/repositories";
import { activityQuerySchema } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSessionUser();
  const params = await searchParams;

  return (
    <>
      <Header
        title="Activity"
        description="Every scheduled execution and its result."
        profile={{
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        }}
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        <Suspense fallback={<ActivityTableSkeleton />}>
          <ActivityContent userId={user.userId} params={params} />
        </Suspense>
      </div>
    </>
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
  const query = parsed.success
    ? parsed.data
    : activityQuerySchema.parse({});

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

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Page {history.page} of {history.totalPages} · {history.total} executions
            </p>

            <div className="flex gap-2">
              <PageLink
                params={params}
                page={history.page - 1}
                disabled={history.page <= 1}
                label="Previous"
              />
              <PageLink
                params={params}
                page={history.page + 1}
                disabled={history.page >= history.totalPages}
                label="Next"
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function PageLink({
  params,
  page,
  disabled,
  label,
}: {
  params: Record<string, string | string[] | undefined>;
  page: number;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {label}
      </Button>
    );
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && key !== "page") search.set(key, value);
  }
  search.set("page", String(page));

  return (
    <Button asChild variant="outline" size="sm">
      <Link href={"/dashboard/activity?" + search.toString()}>{label}</Link>
    </Button>
  );
}
