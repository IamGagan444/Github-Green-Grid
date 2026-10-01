"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  id?: string;
  value: string | null;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Shown on the trigger when `value` is not among `options` (e.g. not loaded yet). */
  fallbackLabel?: string;
  "aria-invalid"?: boolean;
}

const VISIBLE_LIMIT = 100;

/** Combobox for long option lists (repositories, branches, channels). */
export function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
  loading,
  disabled,
  fallbackLabel,
  ...rest
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = options.find((option) => option.value === value);
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? options.filter(
          (option) =>
            option.label.toLowerCase().includes(needle) || option.hint?.toLowerCase().includes(needle),
        )
      : options;
    return matches.slice(0, VISIBLE_LIMIT);
  }, [options, query]);

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
          aria-invalid={rest["aria-invalid"]}
          disabled={disabled}
          className="w-full justify-between font-normal aria-invalid:border-destructive"
        >
          <span className={cn("truncate", !selected && !fallbackLabel && "text-muted-foreground")}>
            {selected?.label ?? fallbackLabel ?? placeholder}
          </span>
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-8"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto p-1 scrollbar-subtle" role="listbox">
          {loading ? (
            <li className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
            </li>
          ) : filtered.length === 0 ? (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</li>
          ) : (
            filtered.map((option) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value} role="option" aria-selected={isSelected} aria-disabled={option.disabled}>
                  <button
                    type="button"
                    disabled={option.disabled}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                      "hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                      isSelected && "bg-secondary/70",
                    )}
                  >
                    <Check className={cn("size-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.hint ? <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
