"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderGit2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { RepositoryCard } from "@/components/repositories/repository-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, messageFor } from "@/lib/client/api-client";
import type { StoredRepository } from "@/lib/services/repositories";

interface RepositoryListResponse {
  repositories: StoredRepository[];
}

export function RepositorySelector({
  initialRepositories,
}: {
  initialRepositories: StoredRepository[];
}) {
  const router = useRouter();
  const [repositories, setRepositories] = React.useState(initialRepositories);
  const [query, setQuery] = React.useState("");
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [selectingId, setSelectingId] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return repositories;
    return repositories.filter((repository) =>
      repository.fullName.toLowerCase().includes(needle),
    );
  }, [repositories, query]);

  async function refresh() {
    setIsRefreshing(true);
    try {
      const data = await apiFetch<RepositoryListResponse>("/api/github/repositories?refresh=1");
      setRepositories(data.repositories);
      toast.success("Repository list updated.");
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function select(repository: StoredRepository) {
    setSelectingId(repository.id);
    try {
      await apiFetch("/api/github/repositories", {
        method: "POST",
        body: JSON.stringify({ githubRepositoryId: repository.githubRepositoryId }),
      });

      setRepositories((current) =>
        current.map((entry) => ({ ...entry, selected: entry.id === repository.id })),
      );
      toast.success(repository.fullName + " is now the active repository.");
      router.refresh();
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      setSelectingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex w-full max-w-sm flex-col gap-1.5">
          <Label htmlFor="repository-search" className="text-xs text-muted-foreground">
            Search repositories
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="repository-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="owner/name"
              className="pl-9"
            />
          </div>
        </div>

        <Button variant="outline" onClick={refresh} disabled={isRefreshing}>
          <RefreshCw className={isRefreshing ? "animate-spin" : undefined} aria-hidden="true" />
          {isRefreshing ? "Refreshing…" : "Refresh from GitHub"}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title={
            repositories.length === 0
              ? "No repositories loaded yet."
              : "No repositories match that search."
          }
          description={
            repositories.length === 0
              ? "Pull your repositories from GitHub to choose one for automation."
              : undefined
          }
          action={
            repositories.length === 0 ? (
              <Button onClick={refresh} disabled={isRefreshing}>
                Load repositories
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {filtered.map((repository) => (
            <li key={repository.id}>
              <RepositoryCard
                repository={repository}
                onSelect={select}
                isSelecting={selectingId === repository.id}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
