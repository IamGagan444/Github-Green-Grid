import { Ban, CircleCheck } from "lucide-react";

import { setAutomationDisabledAction } from "@/app/actions/admin";
import { ConfirmAction } from "@/components/settings/confirm-action";

export function AutomationStatusControl({
  automationId,
  name,
  status,
}: {
  automationId: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
}) {
  if (status !== "DISABLED") {
    return (
      <ConfirmAction
        action={setAutomationDisabledAction}
        fields={{ id: automationId, disabled: "true" }}
        triggerLabel="Disable"
        triggerIcon={<Ban aria-hidden="true" />}
        title={`Disable “${name}”?`}
        description="The automation stops running and the owner cannot resume it until an administrator enables it again. Its configuration and history are kept."
        confirmLabel="Disable automation"
      />
    );
  }
  return (
    <ConfirmAction
      action={setAutomationDisabledAction}
      fields={{ id: automationId, disabled: "false" }}
      triggerLabel="Enable"
      triggerIcon={<CircleCheck aria-hidden="true" />}
      title={`Enable “${name}”?`}
      description="The automation returns to Paused. The owner decides when to resume it."
      confirmLabel="Enable automation"
      destructive={false}
    />
  );
}
