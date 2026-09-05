import type { Metadata } from "next";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Privacy" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const user = await getSessionUser();

  return (
    <MarketingShell isAuthenticated={user !== null}>
      <article className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          How GreenGrid handles your GitHub data.
        </p>

        <div className="mt-10 flex flex-col gap-8 text-sm leading-relaxed">
          <Section title="What we store">
            <p>
              When you sign in with GitHub, GreenGrid stores your GitHub user ID, username,
              display name, avatar URL and — where you have granted the scope — your primary
              verified email address. We also store the repositories you can access, the
              schedules you create, and a record of every execution GreenGrid performs.
            </p>
          </Section>

          <Section title="Access tokens">
            <p>
              Your GitHub access token is encrypted with AES-256-GCM before it is written to the
              database. It is decrypted only inside the server process that calls GitHub on your
              behalf. Tokens are never sent to the browser, never written to logs, never included
              in error messages, and never placed in URLs or browser storage.
            </p>
          </Section>

          <Section title="What we do with GitHub access">
            <p>
              GreenGrid reads your repository list and permissions, reads and updates the single
              maintenance file you configure, and creates commits through GitHub&apos;s official
              REST API. Commits are attributed to your authenticated GitHub account. GreenGrid
              does not scrape GitHub, does not use browser automation, and does not fabricate
              author identities.
            </p>
          </Section>

          <Section title="Sessions">
            <p>
              Sessions are opaque random tokens stored as a hash in our database and referenced by
              an httpOnly, SameSite=Lax cookie. Signing out deletes the session record.
            </p>
          </Section>

          <Section title="Deleting your data">
            <p>
              Disconnecting GitHub from the Settings page revokes GreenGrid&apos;s OAuth grant and
              deletes your account, repository records, schedules and activity history. Commits
              already created in your repositories are yours and remain untouched.
            </p>
          </Section>

          <Section title="Contribution graph">
            <p>
              GreenGrid does not control GitHub&apos;s contribution graph. Whether an activity
              appears on your profile depends entirely on GitHub&apos;s contribution rules.
            </p>
          </Section>
        </div>
      </article>
    </MarketingShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-medium tracking-tight">{title}</h2>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}
