import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SetupStep } from "@/services/dashboard-service";

/**
 * Getting-started checklist. Shown until every step is done, so a new user
 * always sees the next thing to do instead of empty widgets.
 */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;
  const next = steps.find((step) => !step.done);
  const percent = Math.round((done / steps.length) * 100);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Get started</CardTitle>
            <CardDescription>
              {done === 0
                ? "A few quick steps. Each one switches on another automation."
                : `${done} of ${steps.length} done. Next: ${next?.label.toLowerCase()}.`}
            </CardDescription>
          </div>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">{percent}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setup progress"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {steps.map((step, index) => {
            const isNext = step.id === next?.id;
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                    step.done ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {step.done ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-medium", step.done && "text-muted-foreground line-through")}>
                    {step.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{step.description}</span>
                </span>
                {!step.done ? (
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : null}
              </>
            );
            const className = cn(
              "flex h-full items-start gap-3 rounded-lg border p-3 transition-colors",
              step.done
                ? "border-transparent bg-secondary/30"
                : isNext
                  ? "border-primary/60 bg-primary/5 hover:bg-primary/10"
                  : "border-border hover:bg-secondary/50",
            );
            return (
              <li key={step.id}>
                {step.done ? (
                  <div className={className}>
                    <span className="sr-only">Done: </span>
                    {body}
                  </div>
                ) : step.external ? (
                  <a href={step.href} className={className}>
                    {body}
                  </a>
                ) : (
                  <Link href={step.href} className={className}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
