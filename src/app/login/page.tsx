import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signInWithGoogle } from "@/app/actions/auth";
import { GoogleIcon } from "@/components/icons/google-icon";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/** Keys are our own rejection reasons plus Auth.js error codes. */
const ERROR_MESSAGES: Record<string, string> = {
  account_disabled: "Your account has been disabled. Contact an administrator if you think this is a mistake.",
  email_unverified: "Your Google account email must be verified to sign in.",
  provider_not_allowed: "Only Google sign-in is supported.",
  AccessDenied: "Access was denied. Your account may be disabled.",
  OAuthSignin: "Could not start Google sign-in. Please try again.",
  OAuthCallback: "Google sign-in could not be completed. Please try again.",
  OAuthCallbackError: "Google sign-in could not be completed. Please try again.",
  OAuthAccountNotLinked: "This email is already linked to another sign-in method.",
  Configuration: "Sign-in is temporarily unavailable. Please try again later.",
  Verification: "The sign-in link is no longer valid.",
  Default: "Something went wrong while signing in. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string; callbackUrl?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  const params = await searchParams;
  const error = params.error ? (ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.Default) : undefined;
  const returnTo = params.returnTo ?? "/dashboard";

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
              Sign in with Google, then connect GitHub and Slack from Settings. Integration
              credentials are encrypted on the server and never sent to your browser.
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

          <form action={signInWithGoogle}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="lg" variant="outline" className="w-full">
              <GoogleIcon className="size-4" />
              Continue with Google
            </Button>
          </form>

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
    </main>
  );
}
