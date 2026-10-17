import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Bot,
  CalendarClock,
  History,
  KeyRound,
  LayoutDashboard,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { GithubIcon } from "@/components/icons/github-icon";
import { GoogleIcon } from "@/components/icons/google-icon";
import { InstagramIcon } from "@/components/icons/instagram-icon";
import { SlackIcon } from "@/components/icons/slack-icon";

import { ContributionCalendar } from "@/components/dashboard/contribution-calendar";
import { ContributionDisclaimer } from "@/components/dashboard/contribution-disclaimer";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildDemoCalendar } from "@/lib/activity/demo-calendar";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface Product {
  id: string;
  icon: ReactNode;
  title: string;
  tagline: string;
  flow: Array<{ icon: ReactNode; label: string }>;
  points: string[];
}

const PRODUCTS: Product[] = [
  {
    id: "standups",
    icon: <Bot className="size-5 text-primary" aria-hidden="true" />,
    title: "Standup updates",
    tagline: "Your commits, turned into a daily standup in Slack.",
    flow: [
      { icon: <GithubIcon className="size-4" />, label: "Commits" },
      { icon: <Bot className="size-4" aria-hidden="true" />, label: "AI summary" },
      { icon: <SlackIcon className="size-4" />, label: "Slack thread" },
    ],
    points: [
      "Written only from your real commits",
      "Your schedule and timezone, posted once per slot",
      "Post as the app or as yourself",
    ],
  },
  {
    id: "instagram",
    icon: <MessageCircle className="size-5 text-primary" aria-hidden="true" />,
    title: "Instagram auto-DM",
    tagline: "Someone comments “LINK” on your reel and gets the link in their DMs.",
    flow: [
      { icon: <InstagramIcon className="size-4" />, label: "Comment" },
      { icon: <MessageCircle className="size-4" aria-hidden="true" />, label: "Keyword match" },
      { icon: <InstagramIcon className="size-4" />, label: "DM + reply" },
    ],
    points: [
      "Comment, DM keyword, story reply and mention triggers",
      "Optional follow-gate before the link is sent",
      "Counts triggers, DMs sent and link clicks",
    ],
  },
  {
    id: "commits",
    icon: <CalendarClock className="size-5 text-primary" aria-hidden="true" />,
    title: "Commit activity",
    tagline: "Small, real commits to a repo you choose, on the days you pick.",
    flow: [
      { icon: <CalendarClock className="size-4" aria-hidden="true" />, label: "Schedule" },
      { icon: <GithubIcon className="size-4" />, label: "Repository" },
      { icon: <History className="size-4" aria-hidden="true" />, label: "History" },
    ],
    points: [
      "Pick repositories, days and how often",
      "Runs in your own timezone",
      "Full history of every scheduled run",
    ],
  },
  {
    id: "alerts",
    icon: <BellRing className="size-5 text-primary" aria-hidden="true" />,
    title: "Notification hub",
    tagline: "A new PR or a site going down shows up in Telegram within seconds.",
    flow: [
      { icon: <GithubIcon className="size-4" />, label: "GitHub or uptime" },
      { icon: <BellRing className="size-4" aria-hidden="true" />, label: "Your rules" },
      { icon: <MessageCircle className="size-4" aria-hidden="true" />, label: "Telegram, Slack…" },
    ],
    points: [
      "Pull requests, failed checks, releases and issues",
      "One alert when a site goes down, not one every 15 minutes",
      "Telegram, Discord, Slack or your own Gmail, all free",
    ],
  },
];

const STEPS = [
  { title: "Sign in with Google", description: "One account for everything. No passwords to manage." },
  { title: "Connect only what you need", description: "GitHub, Slack, Instagram or Telegram. Each gets only the access it needs." },
  { title: "Create an automation", description: "Each one is a short form, and you can preview it before saving." },
  { title: "Watch it run", description: "The dashboard shows every run, DM and failure as it happens." },
];

const TRUST = [
  {
    icon: KeyRound,
    title: "Encrypted credentials",
    description: "Every token is encrypted with AES-256-GCM and never reaches your browser.",
  },
  {
    icon: ShieldCheck,
    title: "Official APIs only",
    description: "GitHub, Slack and Meta's official APIs. No scraping, no passwords.",
  },
  {
    icon: LayoutDashboard,
    title: "One dashboard",
    description: "Your automations, their runs and your connected accounts on one screen.",
  },
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  const demo = buildDemoCalendar();
  const cta = (
    <Button asChild size="lg">
      <Link href={user ? "/dashboard" : "/login"}>
        {user ? null : <GoogleIcon className="size-4" />}
        {user ? "Open dashboard" : "Get started with Google"}
      </Link>
    </Button>
  );

  return (
    <MarketingShell isAuthenticated={user !== null}>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              <GithubIcon className="size-3.5" />
              <SlackIcon className="size-3.5" />
              <InstagramIcon className="size-3.5" />
              Standups · Instagram auto-DM · Commit activity · Alerts
            </p>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
              Automate the busywork around your code and your content.
            </h1>
            <p className="mt-5 max-w-2xl text-base text-muted-foreground text-pretty sm:text-lg">
              GreenGrid posts your daily standup to Slack from your commits, DMs a link to everyone who
              comments a keyword on your reels, keeps your repositories active on schedule, and pings
              you in Telegram when a PR opens or your site goes down. Set each one up once and forget
              about it.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              {cta}
              <Button asChild size="lg" variant="outline">
                <Link href="#automations">
                  Explore automations
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="automations" aria-labelledby="automations-heading" className="scroll-mt-16 border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="automations-heading" className="text-2xl font-semibold tracking-tight">
            Pick the ones you need
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Use one or all four. Each one only asks for the account it actually needs.
          </p>

          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {PRODUCTS.map((product) => (
              <li key={product.id}>
                <Card className="flex h-full flex-col p-6">
                  <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-secondary/40">
                    {product.icon}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{product.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{product.tagline}</p>

                  <ol
                    aria-label={`${product.title} flow`}
                    className="mt-5 flex items-center gap-1.5 rounded-lg bg-secondary/40 p-2 text-xs"
                  >
                    {product.flow.map((step, index) => (
                      <li key={step.label} className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-background px-2 py-1.5">
                          {step.icon}
                          <span className="truncate">{step.label}</span>
                        </span>
                        {index < product.flow.length - 1 ? (
                          <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                        ) : null}
                      </li>
                    ))}
                  </ol>

                  <ul className="mt-5 flex flex-col gap-2 text-sm">
                    {product.points.map((point) => (
                      <li key={point} className="flex gap-2">
                        <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                        <span className="text-muted-foreground">{point}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-16 border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
            Up and running in minutes
          </h2>

          <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full p-5">
                  <span
                    aria-hidden="true"
                    className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums"
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

      <section aria-labelledby="trust-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="trust-heading" className="text-2xl font-semibold tracking-tight">
            Built to run safely
          </h2>
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {TRUST.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.title}>
                  <Card className="h-full p-5">
                    <Icon className="size-4 text-primary" aria-hidden="true" />
                    <h3 className="mt-3 text-sm font-medium">{item.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{item.description}</p>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section aria-labelledby="calendar-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="calendar-heading" className="text-lg font-semibold tracking-tight">
            Commit activity at a glance
          </h2>
          <Card className="mt-6 p-5">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-medium">Activity over the last year</h3>
              <span className="text-xs text-muted-foreground">Example data</span>
            </div>
            <ContributionCalendar startDate={demo.startDate} endDate={demo.endDate} activities={demo.days} />
          </Card>
          <div className="mt-6">
            <ContributionDisclaimer />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            GreenGrid does not control GitHub&apos;s contribution graph. Whether an activity appears on your
            profile depends on GitHub&apos;s contribution rules.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight">Ready to automate?</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Sign in with Google, connect one account and create your first automation.
        </p>
        <div className="mt-6 flex justify-center">{cta}</div>
      </section>
    </MarketingShell>
  );
}
