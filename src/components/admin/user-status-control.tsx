import { UserCheck, UserX } from "lucide-react";

import { setUserStatusAction } from "@/app/actions/admin";
import { ConfirmAction } from "@/components/settings/confirm-action";

export function UserStatusControl({
  userId,
  label,
  status,
}: {
  userId: string;
  label: string;
  status: "ACTIVE" | "DISABLED";
}) {
  if (status === "ACTIVE") {
    return (
      <ConfirmAction
        action={setUserStatusAction}
        fields={{ id: userId, status: "DISABLED" }}
        triggerLabel="Disable"
        triggerIcon={<UserX aria-hidden="true" />}
        title={`Disable ${label}?`}
        description="They are signed out everywhere immediately, cannot sign in, and none of their automations run. Their data is kept."
        confirmLabel="Disable user"
      />
    );
  }
  return (
    <ConfirmAction
      action={setUserStatusAction}
      fields={{ id: userId, status: "ACTIVE" }}
      triggerLabel="Enable"
      triggerIcon={<UserCheck aria-hidden="true" />}
      title={`Enable ${label}?`}
      description="They can sign in again. Their active automations resume on their next scheduled time."
      confirmLabel="Enable user"
      destructive={false}
    />
  );
}
