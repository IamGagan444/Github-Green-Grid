import { GithubIcon } from "@/components/icons/github-icon";
import { Button } from "@/components/ui/button";
import { getGitHubIntegration } from "@/services/github-service";

/**
 * Shown on pages that need GitHub when the integration is missing or revoked.
 * Renders nothing when GitHub is connected.
 */
export async function GitHubRequiredNotice({ userId, returnTo }: { userId: string; returnTo: string }) {
  const github = await getGitHubIntegration(userId);
  if (github.connected) return null;

  const revoked = github.status === "REVOKED";
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="text-sm font-medium">
          {revoked ? "Your GitHub connection needs to be renewed." : "Connect GitHub to use this page."}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {revoked
            ? "GitHub rejected the stored credential. Reconnect to resume automations — history is kept."
            : "GreenGrid needs your GitHub authorization to read and update repositories."}
        </p>
      </div>
      <Button asChild size="sm">
        <a href={`/api/integrations/github/connect?returnTo=${encodeURIComponent(returnTo)}`}>
          <GithubIcon className="size-4" />
          {revoked ? "Reconnect GitHub" : "Connect GitHub"}
        </a>
      </Button>
    </div>
  );
}
