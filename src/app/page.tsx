import Link from "next/link";
import { Bot, CalendarClock, History, MessageSquareText, ShieldCheck } from "lucide-react";

import { GithubIcon } from "@/components/icons/github-icon";
import { GoogleIcon } from "@/components/icons/google-icon";

import { ContributionCalendar } from "@/components/dashboard/contribution-calendar";
import { ContributionDisclaimer } from "@/components/dashboard/contribution-disclaimer";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildDemoCalendar } from "@/lib/activity/demo-calendar";
import { getCurrentUser } from "@/lib/auth/session";

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
    icon: Bot,
    title: "AI standup updates",
    description: "Your day's commits, summarised by NVIDIA Nemotron into concise standup bullets.",
  },
  {
    icon: MessageSquareText,
    title: "Posted to Slack",
    description: "One dated thread per day in the channel you choose — never duplicated.",
  },
  {
    icon: History,
    title: "Activity history",
    description: "See every scheduled execution and its result.",
  },
  {
    icon: ShieldCheck,
    title: "Privacy-first",
    description: "GitHub and Slack credentials are encrypted and stay server-side.",
  },
];

const STEPS = [
  { title: "Sign in with Google", description: "Your account, with role-based access control." },
  { title: "Connect GitHub and Slack", description: "Least-privilege OAuth; tokens are encrypted at rest." },
  { title: "Create an automation", description: "Repositories, branch, message style, channel and thread style." },
  { title: "Pick a schedule", description: "Days, time and timezone — for example weekdays at 5:00 PM IST." },
  { title: "Nemotron writes the update", description: "Only from your real commits. Invalid output is never posted." },
  { title: "Posted once, in today's thread", description: "Idempotent per day, with full execution history." },
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  const demo = buildDemoCalendar();

  return (
    <MarketingShell isAuthenticated={user !== null}>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Your commits, turned into daily standups.
            </h1>
            <p className="mt-4 text-base text-muted-foreground text-pretty">
              GreenGrid reads the commits you made today, writes a concise standup with AI, and posts
              it to your team&apos;s Slack thread on your schedule. It can also automate lightweight
              repository maintenance through GitHub&apos;s official APIs.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={user ? "/dashboard" : "/login"}>
                  {user ? null : <GoogleIcon className="size-4" />}
                  {user ? "Open dashboard" : "Continue with Google"}
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

          <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              {user ? null : <GoogleIcon className="size-4" />}
              {user ? "Open dashboard" : "Continue with Google"}
            </Link>
          </Button>
        </div>
      </section>
    </MarketingShell>
  );
}
