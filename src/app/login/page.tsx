import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { GithubIcon } from "@/components/icons/github-icon";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the GitHub authorisation. Nothing was changed.",
  invalid_request: "That sign-in link was incomplete. Please try again.",
  invalid_state: "The sign-in request expired or could not be verified. Please try again.",
  connection_failed: "GreenGrid could not reach GitHub. Please try again in a moment.",
  rate_limited: "Too many sign-in attempts. Please wait a minute and try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  const params = await searchParams;
  const error = params.error ? ERROR_MESSAGES[params.error] : undefined;
  const returnTo = params.returnTo;

  const authorizeHref =
    "/api/auth/github" + (returnTo ? "?returnTo=" + encodeURIComponent(returnTo) : "");

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link
        href="/"
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Logo />
      </Link>

      <Card className="mt-8 w-full max-w-sm">
        <CardContent className="flex flex-col gap-5 p-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Sign in to GreenGrid</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              GreenGrid uses GitHub OAuth. Your access token is stored encrypted on the server and
              is never sent to the browser.
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <Button asChild size="lg" className="w-full">
            {/* A plain link: the route handler mints the CSRF state cookie. */}
            <a href={authorizeHref}>
              <GithubIcon className="size-4" />
              Continue with GitHub
            </a>
          </Button>

          <p className="text-xs text-muted-foreground">
            By continuing you agree to the{" "}
            <Link href="/terms" className="text-primary underline-offset-4 hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        GreenGrid creates real commits through GitHub&apos;s API. GitHub independently decides
        which commits appear on your contribution graph.
      </p>
    </main>
  );
}
