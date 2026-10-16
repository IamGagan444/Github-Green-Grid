"use client";

import * as React from "react";
import { useQueries } from "@tanstack/react-query";

import { NativeSelect } from "@/components/hub/action-form";
import { apiFetch, messageFor } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";

interface Workspace {
  id: string;
  teamName: string;
}

interface Channel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

/**
 * Slack channel select for the hub. Channel lists come from the Slack API, so
 * they are fetched only once this picker is shown (not on every page render).
 */
export function SlackChannelPicker({ workspaces }: { workspaces: Workspace[] }) {
  const results = useQueries({
    queries: workspaces.map((workspace) => ({
      queryKey: queryKeys.slackChannels(workspace.id, "BOT"),
      queryFn: () =>
        apiFetch<{ channels: Channel[] }>(`/api/integrations/slack/${encodeURIComponent(workspace.id)}/channels?mode=BOT`),
      staleTime: 5 * 60_000,
    })),
  });

  if (results.some((result) => result.isPending)) {
    return <div aria-hidden="true" className="h-9 animate-pulse rounded-md bg-secondary" />;
  }
  const failed = results.find((result) => result.error);
  if (failed?.error && results.every((result) => !result.data)) {
    return <p className="text-xs text-destructive">{messageFor(failed.error)}</p>;
  }

  return (
    <NativeSelect name="target" required aria-label="Slack channel" defaultValue="">
      <option value="" disabled>
        Pick a channel
      </option>
      {workspaces.map((workspace, index) => {
        const channels = (results[index]?.data?.channels ?? [])
          .filter((channel) => !channel.isPrivate || channel.isMember)
          .slice(0, 200);
        if (channels.length === 0) return null;
        return (
          <optgroup key={workspace.id} label={workspace.teamName}>
            {channels.map((channel) => (
              <option key={channel.id} value={`${workspace.id}:${channel.id}`}>
                #{channel.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </NativeSelect>
  );
}

/** Renders `children` only after the surrounding <details> has been opened once. */
export function WhenOpened({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [opened, setOpened] = React.useState(false);
  React.useEffect(() => {
    const details = ref.current?.closest("details");
    if (!details) {
      setOpened(true);
      return;
    }
    if (details.open) setOpened(true);
    const onToggle = () => details.open && setOpened(true);
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, []);
  return <span ref={ref} className="contents">{opened ? children : null}</span>;
}
