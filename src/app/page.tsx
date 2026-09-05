import Link from "next/link";
import { CalendarClock, FolderGit2, History, ShieldCheck } from "lucide-react";

import { GithubIcon } from "@/components/icons/github-icon";

import { ContributionCalendar } from "@/components/dashboard/contribution-calendar";
import { ContributionDisclaimer } from "@/components/dashboard/contribution-disclaimer";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildDemoCalendar } from "@/lib/activity/demo-calendar";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: GithubIcon,
    title: "GitHub-connected",
    description: "Connect your GitHub account securely.",
  },
  {
    icon: CalendarClock,
    title: "Scheduled activity",
    description: "Choose when GreenGrid should perform repository maintenance.",
  },
  {
    icon: FolderGit2,
    title: "Repository control",
    description: "Choose exactly which repository GreenGrid can update.",
  },
  {
    icon: History,
    title: "Activity history",
    description: "See every scheduled execution and its result.",
  },
  {
    icon: ShieldCheck,
    title: "Privacy-first",
    description: "Your GitHub credentials stay server-side.",
  },
];

const STEPS = [
  { title: "Connect GitHub", description: "Authorise GreenGrid with your GitHub account." },
  { title: "Select a repository", description: "Pick the repository GreenGrid may update." },
  { title: "Choose your schedule", description: "Days, time and timezone are all yours." },
  {
    title: "GreenGrid performs the configured maintenance",
    description: "One commit per scheduled run, through the official API.",
  },
  {
    title: "GitHub processes the resulting commit normally",
    description: "GitHub decides how the commit is reflected on your profile.",
  },
];

export default async function LandingPage() {
  const user = await getSessionUser();
  const demo = buildDemoCalendar();

  return (
    <MarketingShell isAuthenticated={user !== null}>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Keep your GitHub activity consistent.
            </h1>
            <p className="mt-4 text-base text-muted-foreground text-pretty">
              Automate lightweight repository maintenance on your schedule using GitHub&apos;s
              official APIs.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={user ? "/dashboard" : "/login"}>
                  <GithubIcon className="size-4" />
                  Continue with GitHub
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#how-it-works">See how it works</Link>
              </Button>
            </div>
          </div>

          <Card className="mt-12 p-5">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium">Activity over the last year</h2>
              <span className="text-xs text-muted-foreground">Example data</span>
            </div>
            <ContributionCalendar
              startDate={demo.startDate}
              endDate={demo.endDate}
              activities={demo.days}
            />
          </Card>
        </div>
      </section>

      <section aria-labelledby="features-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="features-heading" className="text-lg font-semibold tracking-tight">
            Everything you need to run it safely
          </h2>

          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <li key={feature.title}>
                  <Card className="h-full p-5 transition-colors hover:border-border/80 hover:bg-card/80">
                    <Icon className="size-4 text-primary" aria-hidden="true" />
                    <h3 className="mt-3 text-sm font-medium">{feature.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{feature.description}</p>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="how-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="how-heading" className="text-lg font-semibold tracking-tight">
            How it works
          </h2>

          <ol className="mt-6 grid gap-3 lg:grid-cols-5">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full p-5">
                  <span
                    aria-hidden="true"
                    className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-medium tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-3 text-sm font-medium text-balance">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{step.description}</p>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <ContributionDisclaimer />
        <p className="mt-6 text-sm text-muted-foreground">
          GreenGrid does not control GitHub&apos;s contribution graph. Whether an activity appears
          on your profile depends on GitHub&apos;s contribution rules.
        </p>

        <div className="mt-8">
          <Button asChild>
            <Link href={user ? "/dashboard" : "/login"}>
              <GithubIcon className="size-4" />
              Continue with GitHub
            </Link>
          </Button>
        </div>
      </section>
    </MarketingShell>
  );
}
