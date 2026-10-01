import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-5 px-4 py-6 sm:px-6">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-44 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
