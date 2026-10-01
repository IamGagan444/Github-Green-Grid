import { CheckCircle2, CircleDashed, CirclePause, Loader2, MinusCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";

type RunStatus = "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
type StepStatus = "PENDING" | "SUCCESS" | "FAILED" | "SKIPPED";
type AutomationStatus = "ACTIVE" | "PAUSED" | "DISABLED";
type IntegrationState = "CONNECTED" | "DISCONNECTED" | "REVOKED" | "NOT_CONNECTED";

export function RunStatusBadge({ status }: { status: RunStatus }) {
  switch (status) {
    case "SUCCESS":
      return (
        <Badge variant="success">
          <CheckCircle2 aria-hidden="true" />
          Success
        </Badge>
      );
    case "FAILED":
      return (
        <Badge variant="destructive">
          <XCircle aria-hidden="true" />
          Failed
        </Badge>
      );
    case "SKIPPED":
      return (
        <Badge variant="outline">
          <MinusCircle aria-hidden="true" />
          Skipped
        </Badge>
      );
    default:
      return (
        <Badge variant="warning">
          <Loader2 aria-hidden="true" className="animate-spin" />
          Running
        </Badge>
      );
  }
}

const STEP_LABEL: Record<StepStatus, string> = {
  PENDING: "Pending",
  SUCCESS: "OK",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export function StepStatusBadge({ status, label }: { status: StepStatus; label?: string }) {
  const variant =
    status === "SUCCESS" ? "success" : status === "FAILED" ? "destructive" : status === "SKIPPED" ? "outline" : "default";
  return (
    <Badge variant={variant}>
      {label ? `${label}: ` : null}
      {STEP_LABEL[status]}
    </Badge>
  );
}

export function AutomationStatusBadge({ status }: { status: AutomationStatus }) {
  if (status === "ACTIVE") {
    return (
      <Badge variant="success">
        <CheckCircle2 aria-hidden="true" />
        Active
      </Badge>
    );
  }
  if (status === "PAUSED") {
    return (
      <Badge variant="default">
        <CirclePause aria-hidden="true" />
        Paused
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <XCircle aria-hidden="true" />
      Disabled
    </Badge>
  );
}

export function IntegrationBadge({ status }: { status: IntegrationState }) {
  if (status === "CONNECTED") {
    return (
      <Badge variant="success">
        <CheckCircle2 aria-hidden="true" />
        Connected
      </Badge>
    );
  }
  if (status === "REVOKED") {
    return (
      <Badge variant="warning">
        <XCircle aria-hidden="true" />
        Needs reconnect
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <CircleDashed aria-hidden="true" />
      Not connected
    </Badge>
  );
}
