"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = ["ALL", "COMPLETED", "FAILED", "SKIPPED"] as const;

const STATUS_LABEL: Record<(typeof STATUS_FILTERS)[number], string> = {
  ALL: "All",
  COMPLETED: "Completed",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export interface RepositoryOption {
  id: string;
  fullName: string;
}

/** Filters are URL state, so the view is shareable and survives a refresh. */
export function ActivityFilters({ repositories }: { repositories: RepositoryOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const status = searchParams.get("status") ?? "ALL";
  const repositoryId = searchParams.get("repositoryId") ?? "all";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  function apply(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "" || value === "all") params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");

    startTransition(() => {
      router.replace(params.size > 0 ? pathname + "?" + params.toString() : pathname);
    });
  }

  return (
    <div
      className={cn("flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between", isPending && "opacity-70")}
    >
      <div
        role="group"
        aria-label="Filter by status"
        className="flex w-fit gap-1 rounded-lg border border-border p-1"
      >
        {STATUS_FILTERS.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={status === value ? "secondary" : "ghost"}
            aria-pressed={status === value}
            onClick={() => apply({ status: value === "ALL" ? null : value })}
          >
            {STATUS_LABEL[value]}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="repository-filter" className="text-xs text-muted-foreground">
            Repository
          </Label>
          <Select value={repositoryId} onValueChange={(value) => apply({ repositoryId: value })}>
            <SelectTrigger id="repository-filter" className="sm:w-56">
              <SelectValue placeholder="All repositories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All repositories</SelectItem>
              {repositories.map((repository) => (
                <SelectItem key={repository.id} value={repository.id}>
                  {repository.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from-filter" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="from-filter"
            type="date"
            value={from}
            onChange={(event) => apply({ from: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to-filter" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="to-filter"
            type="date"
            value={to}
            onChange={(event) => apply({ to: event.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
