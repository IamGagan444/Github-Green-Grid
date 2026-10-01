"use client";

import * as React from "react";
import { toast } from "sonner";

import type { ActionState } from "@/lib/actions/action-state";

/** Toasts each new Server Action result and runs `onSuccess` after a success. */
export function useActionToast(state: ActionState, onSuccess?: () => void): void {
  const handleSuccess = React.useEffectEvent(() => onSuccess?.());

  React.useEffect(() => {
    if (state.status === "idle") return;
    if (state.status === "success") {
      toast.success(state.message);
      handleSuccess();
    } else {
      toast.error(state.message);
    }
  }, [state]);
}
