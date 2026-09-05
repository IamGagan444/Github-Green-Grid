import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CheckCircle2, GitBranch, ShieldAlert } from "lucide-react";

import { Header } from "@/components/layout/header";
import { RepositorySelector } from "@/components/repositories/repository-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RepositorySkeleton } from "@/components/ui/skeletons";
import { requireSessionUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getSelectedRepository, listStoredRepositories } from "@/lib/services/repositories";

export const metadata: Metadata = { title: "Repositories" };
export const dynamic = "force-dynamic";

export default async function RepositoriesPage() {
  const user = await requireSessionUser();

  return (
    <>
      <Header
        title="Repositories"
        description="Choose exactly which repository GreenGrid is allowed to update."
        profile={{
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        }}
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/schedule">Configure schedule</Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
        <Suspense fallback={<RepositorySkeleton />}>
          <RepositoriesContent userId={user.userId} />
        </Suspense>
      </div>
    </>
  );
}

async function RepositoriesContent({ userId }: { userId: string }) {
  const [repositories, selected] = await Promise.all([
    listStoredRepositories(userId),
    getSelectedRepository(userId),
  ]);

  return (
    <>
      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle>Selected repository</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">Repository</dt>
                <dd className="mt-1 truncate text-sm font-medium">{selected.fullName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Default branch</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-sm">
                  <GitBranch className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {selected.defaultBranch}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Last activity</dt>
                <dd className="mt-1 text-sm">
                  {selected.lastActivityAt ? formatDate(selected.lastActivityAt) : "None recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Permission status</dt>
                <dd className="mt-1">
                  {selected.canPush && !selected.archived ? (
                    <Badge variant="success">
                      <CheckCircle2 aria-hidden="true" />
                      Write access verified
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <ShieldAlert aria-hidden="true" />
                      GreenGrid can no longer write here
                    </Badge>
                  )}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <RepositorySelector initialRepositories={repositories} />
    </>
  );
}
