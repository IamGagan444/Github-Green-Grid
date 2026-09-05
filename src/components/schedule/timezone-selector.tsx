"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatUtcOffset } from "@/lib/schedule/timezone";
import { COMMON_TIMEZONES, searchTimezones } from "@/lib/schedule/timezone-search";
import { cn } from "@/lib/utils";

interface TimezoneSelectorProps {
  id?: string;
  value: string;
  timezones: string[];
  onChange: (timezone: string) => void;
  disabled?: boolean;
}

const VISIBLE_LIMIT = 80;

/**
 * Searchable timezone combobox. The full IANA list is too long for a plain
 * select, so results are filtered and capped as the user types.
 */
export function TimezoneSelector({
  id,
  value,
  timezones,
  onChange,
  disabled,
}: TimezoneSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const results = React.useMemo(
    () => searchTimezones(timezones, query, VISIBLE_LIMIT),
    [timezones, query],
  );

  // Without a query the list opens with the pinned common zones; label the
  // boundary so it is clear the rest of the world is still below.
  const pinnedCount = query.trim()
    ? 0
    : results.filter((zone) => COMMON_TIMEZONES.includes(zone as never)).length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{value}</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {formatUtcOffset(value)}
            <ChevronsUpDown className="size-4" aria-hidden="true" />
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by country or city, e.g. india"
            aria-label="Search timezones by country or city"
            className="h-8"
          />
        </div>

        <ul className="max-h-64 overflow-y-auto p-1 scrollbar-subtle" role="listbox">
          {results.length === 0 ? (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
              No timezone matches that search.
            </li>
          ) : (
            results.map((zone, index) => (
              <li key={zone}>
                {pinnedCount > 0 && index === pinnedCount ? (
                  <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    All timezones
                  </p>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={zone === value}
                  onClick={() => {
                    onChange(zone);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    zone === value && "bg-accent",
                  )}
                >
                  <span className="truncate">{zone}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {formatUtcOffset(zone)}
                    {zone === value ? (
                      <Check className="size-3.5 text-primary" aria-hidden="true" />
                    ) : null}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
