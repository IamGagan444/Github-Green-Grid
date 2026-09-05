import { cn } from "@/lib/utils";

/** GreenGrid mark: a 3x3 contribution grid with one filled cell. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 grid-cols-3 grid-rows-3 gap-[2px] rounded-[5px] border border-border bg-card p-[3px]"
      >
        <span className="rounded-[1px] bg-contribution-empty" />
        <span className="rounded-[1px] bg-contribution-low" />
        <span className="rounded-[1px] bg-contribution-empty" />
        <span className="rounded-[1px] bg-contribution-medium" />
        <span className="rounded-[1px] bg-contribution-very-high" />
        <span className="rounded-[1px] bg-contribution-high" />
        <span className="rounded-[1px] bg-contribution-empty" />
        <span className="rounded-[1px] bg-contribution-medium" />
        <span className="rounded-[1px] bg-contribution-empty" />
      </span>
      <span className="text-sm font-semibold tracking-tight">GreenGrid</span>
    </span>
  );
}
