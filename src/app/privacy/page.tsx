import type { Metadata } from "next";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Privacy" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const user = await getCurrentUser();

  return (
    <MarketingShell isAuthenticated={user !== null}>
      <article className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          How GreenGrid handles your Google, GitHub and Slack data.
        </p>

        <div className="mt-10 flex flex-col gap-8 text-sm leading-relaxed">
          <Section title="What we store">
            <p>
              When you sign in with Google, GreenGrid stores your name, email address and profile
              image. When you connect GitHub it stores your GitHub user ID, username and avatar;
              when you connect Slack it stores the workspace name and ID and your Slack user ID. We
              also store the automations and schedules you create and a record of every execution,
              including the generated standup text and the Slack message identifiers.
            </p>
          </Section>

          <Section title="Access tokens">
            <p>
              GitHub and Slack access tokens are encrypted with AES-256-GCM before they are written
              to the database and are decrypted only inside the server process that calls those
              services on your behalf. Google sign-in tokens are not stored at all. Tokens are never
              sent to the browser, never written to logs, never included in error messages, never
              placed in URLs or browser storage, and are not visible to administrators.
            </p>
          </Section>

          <Section title="What we do with GitHub access">
            <p>
              For standup automations GreenGrid reads the commits you authored in the repositories
              and branches you select, for the configured day only. For commit-activity schedules
              it reads and updates the single maintenance file you configure and creates commits
              through GitHub&apos;s official REST API, attributed to your account.
            </p>
          </Section>

          <Section title="AI processing">
            <p>
              To write a standup, the commit messages (and, if you enable it, changed file names and
              line counts) from the selected day, plus your optional quick note, are sent to NVIDIA&apos;s
              API and processed by the Nemotron model. Nothing else from your repositories — no
              source code — is sent. Calls are made from our server; your browser never contacts the
              AI provider.
            </p>
          </Section>

          <Section title="What we do with Slack access">
            <p>
              GreenGrid lists channels so you can choose one, reads that channel&apos;s messages for
              the current day to find the daily thread and avoid duplicate posts, and posts your
              update — as the GreenGrid app, or as you if you chose &ldquo;Post as me&rdquo;.
            </p>
          </Section>

          <Section title="Sessions">
            <p>
              Sessions are opaque random tokens stored as a hash in our database and referenced by
              an httpOnly, SameSite=Lax cookie. Signing out deletes the session record, and a
              disabled account loses all sessions immediately.
            </p>
          </Section>

          <Section title="Deleting your data">
            <p>
              Disconnecting GitHub or Slack in Settings revokes GreenGrid&apos;s access and deletes the
              stored credential while keeping your automation history. Deleting your account from
              Settings revokes both integrations and deletes your account, automations, schedules and
              history. Commits and Slack messages already created remain untouched.
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
