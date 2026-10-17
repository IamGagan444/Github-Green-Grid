import Link from "next/link";
import { BellRing, CheckCircle2, Circle, FileSpreadsheet, IndianRupee, Newspaper, Repeat2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface GalleryConnections {
  telegram: boolean;
  discord: boolean;
  googleSheets: boolean;
  googleEmail: boolean;
  aiKey: boolean;
  github: boolean;
  slack: boolean;
}

interface Requirement {
  label: string;
  done: boolean;
  optional?: boolean;
}

interface GalleryItem {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  requirements: Requirement[];
  href: string | null;
  cta: string;
}

/** The five free automations built on the notification hub, with the connections each one needs. */
export function AutomationGallery({ connections, hubReady }: { connections: GalleryConnections; hubReady: boolean }) {
  const anyChannel = connections.telegram || connections.discord || connections.slack || connections.googleEmail;
  const items: GalleryItem[] = [
    {
      id: "hub",
      icon: BellRing,
      title: "Notification hub",
      description: "GitHub PRs, failed checks, releases and uptime alerts, routed to Telegram, Discord, Slack or email.",
      requirements: [
        { label: "A channel (Telegram, Discord, Slack or email)", done: anyChannel },
        { label: "GitHub App installed (for GitHub events)", done: connections.github, optional: true },
      ],
      href: hubReady ? "/notifications?tab=rules" : "/notifications?tab=channels",
      cta: hubReady ? "Manage rules" : "Connect a channel",
    },
    {
      id: "digest",
      icon: Newspaper,
      title: "AI morning digest",
      description: "Blogs, YouTube, GitHub releases and Hacker News in one message each morning, summed up by your own AI key.",
      requirements: [
        { label: "Telegram or another channel", done: anyChannel },
        { label: "Your AI key", done: connections.aiKey, optional: true },
      ],
      href: "/digest",
      cta: "Set up digest",
    },
    {
      id: "crosspost",
      icon: Repeat2,
      title: "Cross-poster",
      description: "New YouTube video or blog post → AI-drafted posts for LinkedIn, Telegram and Discord, with approval.",
      requirements: [
        { label: "Telegram (for approvals)", done: connections.telegram },
        { label: "LinkedIn", done: false },
        { label: "Your AI key", done: connections.aiKey, optional: true },
      ],
      href: null,
      cta: "Coming next",
    },
    {
      id: "forms",
      icon: FileSpreadsheet,
      title: "Form → Google Sheet",
      description: "A shareable form that saves every response to your Sheet and alerts you instantly.",
      requirements: [
        { label: "Google (Sheets)", done: connections.googleSheets },
        { label: "A channel for alerts", done: anyChannel, optional: true },
      ],
      href: "/forms",
      cta: "Create a form",
    },
    {
      id: "reminders",
      icon: IndianRupee,
      title: "Payment reminders",
      description: "Polite reminders from your Gmail, plus a one-tap WhatsApp message and UPI link for you to send.",
      requirements: [
        { label: "Google (Gmail)", done: connections.googleEmail },
        { label: "A channel for your copy", done: anyChannel, optional: true },
      ],
      href: "/reminders",
      cta: "Chase a payment",
    },
  ];

  return (
    <section aria-labelledby="gallery-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="gallery-heading" className="text-sm font-medium text-muted-foreground">
          Free automations
        </h2>
        <Link href="/settings/connections" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          Manage connections
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.id} className="flex flex-col">
              <CardHeader className="gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex size-8 items-center justify-center rounded-md border border-border bg-secondary/40">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  {item.href ? null : <Badge variant="outline">{item.cta}</Badge>}
                </div>
                <CardTitle className="text-sm">{item.title}</CardTitle>
                <CardDescription className="text-xs">{item.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto flex flex-col gap-3 pt-0">
                <ul className="flex flex-col gap-1 text-xs">
                  {item.requirements.map((requirement) => (
                    <li key={requirement.label} className="flex items-start gap-1.5">
                      {requirement.done ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Done" />
                      ) : (
                        <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Not yet" />
                      )}
                      <span className={requirement.done ? "" : "text-muted-foreground"}>
                        {requirement.label}
                        {requirement.optional ? " (optional)" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {item.href ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={item.href}>{item.cta}</Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
