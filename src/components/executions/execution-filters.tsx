"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUSES = [
  { value: "ALL", label: "All statuses" },
  { value: "SUCCESS", label: "Success" },
  { value: "FAILED", label: "Failed" },
  { value: "SKIPPED", label: "Skipped" },
  { value: "RUNNING", label: "Running" },
];

/** URL-driven filters so results are shareable and server-rendered. */
export function ExecutionFilters({
  automations,
  basePath,
}: {
  automations?: Array<{ id: string; name: string }>;
  basePath: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string, defaultValue: string) {
    const next = new URLSearchParams(params.toString());
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    next.delete("page");
    router.push(`${pathname ?? basePath}?${next.toString()}`);
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Select value={params.get("status") ?? "ALL"} onValueChange={(value) => update("status", value, "ALL")}>
        <SelectTrigger className="sm:w-44" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((status) => (
            <SelectItem key={status.value} value={status.value}>
              {status.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {automations && automations.length > 0 ? (
        <Select value={params.get("automationId") ?? "ALL"} onValueChange={(value) => update("automationId", value, "ALL")}>
          <SelectTrigger className="sm:w-64" aria-label="Filter by automation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All automations</SelectItem>
            {automations.map((automation) => (
              <SelectItem key={automation.id} value={automation.id}>
                {automation.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
