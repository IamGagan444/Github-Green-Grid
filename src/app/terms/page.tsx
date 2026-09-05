import type { Metadata } from "next";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Terms" };
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const user = await getSessionUser();

  return (
    <MarketingShell isAuthenticated={user !== null}>
      <article className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Terms</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The agreement between you and GreenGrid.
        </p>

        <div className="mt-10 flex flex-col gap-8 text-sm leading-relaxed">
          <Section title="What the service does">
            <p>
              GreenGrid performs small, configured repository maintenance updates on a schedule
              you choose. Each scheduled execution normally results in exactly one commit to the
              repository you selected, created through GitHub&apos;s official REST API and
              attributed to your authenticated GitHub account.
            </p>
          </Section>

          <Section title="Your responsibilities">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                Only select repositories you own or have been granted write access to, and where
                automated maintenance commits are acceptable to the other maintainers.
              </li>
              <li>
                Comply with GitHub&apos;s Terms of Service and Acceptable Use Policies at all
                times while using GreenGrid.
              </li>
              <li>
                Keep your GitHub account secure. Anyone with access to your account can change
                what GreenGrid does on your behalf.
              </li>
            </ul>
          </Section>

          <Section title="No guarantee about the contribution graph">
            <p>
              GreenGrid makes no promise that any commit will appear as a contribution on your
              GitHub profile. GitHub independently determines which commits count, based on rules
              that can change at any time and are outside GreenGrid&apos;s control.
            </p>
          </Section>

          <Section title="Availability">
            <p>
              Scheduled runs depend on GitHub&apos;s API and on the scheduler that triggers them.
              Runs may be delayed, skipped or fail — for example during a GitHub outage or when a
              rate limit is reached. Failures are recorded in your activity history.
            </p>
          </Section>

          <Section title="Termination">
            <p>
              You may disconnect GitHub and delete your GreenGrid data at any time from the
              Settings page. We may suspend accounts that use GreenGrid in ways that violate these
              terms or GitHub&apos;s policies.
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
