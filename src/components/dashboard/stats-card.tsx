import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "success" | "destructive";
}

const TONE_CLASS: Record<NonNullable<StatsCardProps["tone"]>, string> = {
  default: "text-muted-foreground",
  success: "text-success",
  destructive: "text-destructive",
};

export function StatsCard({ label, value, hint, icon: Icon, tone = "default" }: StatsCardProps) {
  return (
    <Card className="p-4 transition-colors hover:border-border/80 hover:bg-card/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          {hint ? <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <Icon className={cn("size-4 shrink-0", TONE_CLASS[tone])} aria-hidden="true" />
      </div>
    </Card>
  );
}
