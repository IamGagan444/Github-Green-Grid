import { Info } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const GITHUB_DOCS_URL =
  "https://docs.github.com/account-and-profile/setting-up-and-managing-your-github-profile/managing-contribution-settings-on-your-profile/why-are-my-contributions-not-showing-up-on-my-profile";

/**
 * Shown wherever a user might otherwise assume GreenGrid controls the
 * contribution graph. It does not — GitHub decides what counts.
 */
export function ContributionDisclaimer({ className }: { className?: string }) {
  return (
    <Card className={cn("bg-secondary/30 p-4", className)}>
      <div className="flex gap-3">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1.5 text-sm">
          <h2 className="font-medium">About GitHub contributions</h2>
          <p className="text-muted-foreground">
            GreenGrid creates real repository commits through GitHub&apos;s APIs. GitHub
            independently determines which commits appear on your contribution graph based on its
            contribution rules.
          </p>
          <a
            href={GITHUB_DOCS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-block rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Read GitHub&apos;s contribution documentation
          </a>
        </div>
      </div>
    </Card>
  );
}
