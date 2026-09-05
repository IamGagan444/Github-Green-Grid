import { CheckCircle2, CircleDashed, Clock, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export type ExecutionStatusValue = "PENDING" | "COMPLETED" | "FAILED" | "SKIPPED";

const STATUS_META: Record<
  ExecutionStatusValue,
  { label: string; icon: LucideIcon; variant: "success" | "destructive" | "outline" | "warning" }
> = {
  COMPLETED: { label: "Completed", icon: CheckCircle2, variant: "success" },
  FAILED: { label: "Failed", icon: XCircle, variant: "destructive" },
  SKIPPED: { label: "Skipped", icon: CircleDashed, variant: "outline" },
  PENDING: { label: "Pending", icon: Clock, variant: "warning" },
};

/** Status pill that pairs colour with an icon and text, never colour alone. */
export function ActivityStatus({ status }: { status: ExecutionStatusValue }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <Badge variant={meta.variant}>
      <Icon aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}
