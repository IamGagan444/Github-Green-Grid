import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholders sized to match their real counterparts so that
 * hydration does not shift layout.
 */

export function StatsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-14" />
          <Skeleton className="mt-2 h-3 w-20" />
        </Card>
      ))}
    </div>
  );
}

export function CalendarSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-4 h-[120px] w-full" />
      <div className="mt-3 flex justify-between">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
    </Card>
  );
}

export function RepositorySkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="w-full space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
              <div className="flex gap-2 pt-1">
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function ActivityTableSkeleton() {
  return (
    <Card className="p-0">
      <div className="border-b border-border px-4 py-3">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ScheduleSkeleton() {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-36" />
          </div>
        ))}
      </div>
    </Card>
  );
}
