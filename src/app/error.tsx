"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. Users see a short explanation; the underlying
 * error is logged, never rendered.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui] unhandled error", error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold tracking-tight">Something went wrong.</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        GreenGrid could not load this page. Your schedules and repository settings are unchanged.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <a href="/dashboard">Back to dashboard</a>
        </Button>
      </div>
    </main>
  );
}
