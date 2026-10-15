import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ProductMetric {
  label: string;
  value: number;
  tone?: "default" | "success" | "destructive";
}

/**
 * One automation product (standups, Instagram, commit activity) on the
 * dashboard: what it does, whether it is set up, its numbers and the next action.
 */
export function ProductCard({
  icon,
  title,
  description,
  status,
  metrics,
  primary,
  secondary,
  blocker,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status: { label: string; tone: "active" | "idle" | "setup" };
  metrics: ProductMetric[];
  primary: { label: string; href: string; external?: boolean };
  secondary?: { label: string; href: string };
  /** Shown instead of metrics while a required integration is missing. */
  blocker?: string;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-secondary/40">
            {icon}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
              status.tone === "active" && "bg-success/10 text-success",
              status.tone === "idle" && "bg-secondary text-muted-foreground",
              status.tone === "setup" && "bg-warning/10 text-warning",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                status.tone === "active" && "bg-success",
                status.tone === "idle" && "bg-muted-foreground",
                status.tone === "setup" && "bg-warning",
              )}
            />
            {status.label}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>

      <CardContent className="mt-auto flex flex-col gap-4 pt-0">
        {blocker ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            {blocker}
          </p>
        ) : (
          <dl className="grid grid-cols-3 gap-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg bg-secondary/40 px-2.5 py-2">
                <dt className="truncate text-[11px] text-muted-foreground">{metric.label}</dt>
                <dd
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    metric.tone === "success" && metric.value > 0 && "text-success",
                    metric.tone === "destructive" && metric.value > 0 && "text-destructive",
                  )}
                >
                  {metric.value.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            {primary.external ? (
              <a href={primary.href}>
                {primary.label}
                <ArrowRight aria-hidden="true" />
              </a>
            ) : (
              <Link href={primary.href}>
                {primary.label}
                <ArrowRight aria-hidden="true" />
              </Link>
            )}
          </Button>
          {secondary ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={secondary.href}>{secondary.label}</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
