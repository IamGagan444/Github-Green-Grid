import "server-only";

import type { WizardWorkspace } from "@/components/automations/automation-wizard";
import { listSupportedTimezones } from "@/lib/schedule/timezone";
import { getGitHubIntegration } from "@/services/github-service";
import { listSlackIntegrations } from "@/services/slack-service";

/** Server-side data the automation wizard needs. Contains no credentials. */
export async function loadWizardContext(userId: string) {
  const [github, slack] = await Promise.all([getGitHubIntegration(userId), listSlackIntegrations(userId)]);
  const workspaces: WizardWorkspace[] = slack.map((workspace) => ({
    id: workspace.id,
    teamName: workspace.teamName,
    status: workspace.status,
    userPostingAvailable: workspace.userPostingAvailable,
  }));
  return {
    githubConnected: github.connected,
    githubUsername: github.username,
    workspaces,
    timezones: listSupportedTimezones(),
  };
}
