"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

const MESSAGES: Record<string, Record<string, { type: "success" | "error"; text: string }>> = {
  github: {
    connected: { type: "success", text: "GitHub connected." },
    linked_elsewhere: { type: "error", text: "That GitHub account is already connected to another GreenGrid user." },
    access_denied: { type: "error", text: "GitHub authorization was cancelled. Nothing changed." },
    missing_state: { type: "error", text: "The GitHub connection request expired. Please try again." },
    invalid_state: { type: "error", text: "The GitHub connection request could not be verified. Please try again." },
    user_mismatch: { type: "error", text: "The GitHub connection was started by a different session." },
    invalid_request: { type: "error", text: "GitHub returned an incomplete response. Please try again." },
    connection_failed: { type: "error", text: "GitHub could not complete the connection. Please try again." },
    rate_limited: { type: "error", text: "Too many connection attempts. Please wait a few minutes." },
  },
  slack: {
    connected: { type: "success", text: "Slack workspace connected." },
    not_configured: { type: "error", text: "Slack is not configured on this server yet." },
    access_denied: { type: "error", text: "Slack authorization was cancelled. Nothing changed." },
    missing_state: { type: "error", text: "The Slack connection request expired. Please try again." },
    invalid_state: { type: "error", text: "The Slack connection request could not be verified. Please try again." },
    user_mismatch: { type: "error", text: "The Slack connection was started by a different session." },
    invalid_request: { type: "error", text: "Slack returned an incomplete response. Please try again." },
    connection_failed: { type: "error", text: "Slack could not complete the connection. Please try again." },
    rate_limited: { type: "error", text: "Too many connection attempts. Please wait a few minutes." },
  },
  // Results of Server Actions that finish with a redirect.
  notice: {
    automation_deleted: { type: "success", text: "Automation deleted. Execution history was kept." },
    run_success: { type: "success", text: "Today's update was posted to Slack." },
    run_skipped: { type: "success", text: "No commits found for today, so nothing was posted." },
    run_failed: { type: "error", text: "The run failed. The details are below." },
  },
};

/** Shows the result of an OAuth round-trip or a redirecting action once, then cleans the URL. */
export function FlashToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const shown = React.useRef(false);

  React.useEffect(() => {
    if (shown.current) return;
    let handled = false;
    for (const provider of Object.keys(MESSAGES)) {
      const code = params.get(provider);
      const message = code ? MESSAGES[provider]?.[code] : undefined;
      if (message) {
        handled = true;
        if (message.type === "success") toast.success(message.text);
        else toast.error(message.text);
      }
    }
    if (handled) {
      shown.current = true;
      router.replace(pathname, { scroll: false });
    }
  }, [params, pathname, router]);

  return null;
}
