import type { Metadata } from "next";
import Image from "next/image";
import { CheckCircle2 } from "lucide-react";

import { ContributionDisclaimer } from "@/components/dashboard/contribution-disclaimer";
import { Header } from "@/components/layout/header";
import { DisconnectGitHub } from "@/components/settings/disconnect-github";
import { SettingsForm } from "@/components/settings/settings-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listSupportedTimezones } from "@/lib/schedule/timezone";
import { getSelectedRepository } from "@/lib/services/repositories";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireSessionUser();

  const [preferences, selected] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { defaultTimezone: true, defaultCommitMessage: true },
    }),
    getSelectedRepository(user.userId),
  ]);

  return (
    <>
      <Header
        title="Settings"
        description="Manage your GitHub connection and automation defaults."
        profile={{
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        }}
      />

      <div className="flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>GitHub account</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-4 pt-0">
            {user.avatarUrl ? (
              <Image
                src={user.avatarUrl}
                alt=""
                width={48}
                height={48}
                className="size-12 rounded-full border border-border"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-12 items-center justify-center rounded-full bg-secondary text-sm font-medium"
              >
                {user.username.slice(0, 1).toUpperCase()}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.username}</p>
              {user.displayName ? (
                <p className="truncate text-xs text-muted-foreground">{user.displayName}</p>
              ) : null}
            </div>

            <Badge variant="success">
              <CheckCircle2 aria-hidden="true" />
              Connected
            </Badge>
          </CardContent>
        </Card>

        <SettingsForm
          defaultValues={{
            defaultTimezone: preferences.defaultTimezone,
            defaultCommitMessage: preferences.defaultCommitMessage,
          }}
          timezones={listSupportedTimezones()}
          selectedRepository={selected?.fullName ?? null}
        />

        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              <li>Your GitHub access token is encrypted with AES-256-GCM before it is stored.</li>
              <li>Tokens are used only on the server and never sent to the browser.</li>
              <li>Sessions are opaque, server-side records tied to an httpOnly cookie.</li>
            </ul>
          </CardContent>
        </Card>

        <ContributionDisclaimer />

        <DisconnectGitHub username={user.username} />
      </div>
    </>
  );
}
