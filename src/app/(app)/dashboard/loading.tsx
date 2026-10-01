import { CalendarSkeleton, StatsSkeleton } from "@/components/ui/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <>
      <div className="border-b border-border px-4 py-6 sm:px-6">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        <StatsSkeleton />
        <CalendarSkeleton />
      </div>
    </>
  );
}
