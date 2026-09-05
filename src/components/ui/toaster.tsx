"use client";

import { Toaster as SonnerToaster } from "sonner";

/** App-wide toast surface, themed with GreenGrid tokens. */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group rounded-lg border border-border bg-popover text-popover-foreground shadow-md",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-secondary text-secondary-foreground",
        },
      }}
    />
  );
}
