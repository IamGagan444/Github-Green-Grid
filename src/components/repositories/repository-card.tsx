"use client";

import { Archive, CheckCircle2, ExternalLink, GitBranch, Lock, ShieldAlert, Unlock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { StoredRepository } from "@/lib/services/repositories";

interface RepositoryCardProps {
  repository: StoredRepository;
  onSelect: (repository: StoredRepository) => void;
  isSelecting: boolean;
}

export function RepositoryCard({ repository, onSelect, isSelecting }: RepositoryCardProps) {
  const blocked = repository.archived || !repository.canPush;

  return (
    <Card className="flex flex-col gap-3 p-4 transition-colors hover:border-border/80 hover:bg-card/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{repository.fullName}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Owner: {repository.owner}
          </p>
        </div>

        {repository.selected ? (
          <Badge variant="success">
            <CheckCircle2 aria-hidden="true" />
            Selected
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={blocked || isSelecting}
            onClick={() => onSelect(repository)}
          >
            {isSelecting ? "Selecting…" : "Select"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">
          {repository.private ? <Lock aria-hidden="true" /> : <Unlock aria-hidden="true" />}
          {repository.private ? "Private" : "Public"}
        </Badge>
        <Badge variant="outline">
          <GitBranch aria-hidden="true" />
          {repository.defaultBranch}
        </Badge>
        <Badge variant={repository.canPush ? "outline" : "destructive"}>
          <ShieldAlert aria-hidden="true" />
          {repository.canPush ? "Write access" : "Read only"}
        </Badge>
        {repository.archived ? (
          <Badge variant="warning">
            <Archive aria-hidden="true" />
            Archived
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {repository.lastActivityAt
            ? "Last activity " + formatDate(repository.lastActivityAt)
            : "No recorded activity"}
        </span>
        {repository.htmlUrl ? (
          <a
            href={repository.htmlUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open on GitHub
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </Card>
  );
}
