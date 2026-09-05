import "server-only";

import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { getGitHubClient, listUserRepositories } from "@/lib/github";

export interface StoredRepository {
  id: string;
  githubRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  canPush: boolean;
  selected: boolean;
  htmlUrl: string | null;
  lastActivityAt: Date | null;
}

/** Upserts run in bounded batches so a slow link cannot exhaust the pool. */
const SYNC_BATCH_SIZE = 20;

/**
 * Pulls the user's repositories from GitHub and mirrors the subset GreenGrid
 * needs into the database. Selection state is preserved across syncs.
 *
 * Deliberately not wrapped in a transaction: an account can have hundreds of
 * repositories, and one round-trip per row inside a single interactive
 * transaction exceeds Prisma's timeout against a remote database. The mirror is
 * idempotent, so a partially applied sync is corrected by the next refresh.
 */
export async function syncRepositories(userId: string): Promise<StoredRepository[]> {
  const octokit = await getGitHubClient(userId);
  const remote = await listUserRepositories(octokit);

  for (let offset = 0; offset < remote.length; offset += SYNC_BATCH_SIZE) {
    const batch = remote.slice(offset, offset + SYNC_BATCH_SIZE);

    await Promise.all(
      batch.map((repo) => {
        const fields = {
          owner: repo.owner,
          name: repo.name,
          fullName: repo.fullName,
          defaultBranch: repo.defaultBranch,
          private: repo.private,
          archived: repo.archived,
          canPush: repo.canPush,
          htmlUrl: repo.htmlUrl,
          lastActivityAt: repo.pushedAt ? new Date(repo.pushedAt) : null,
        };

        return prisma.repository.upsert({
          where: {
            userId_githubRepositoryId: {
              userId,
              githubRepositoryId: repo.githubRepositoryId,
            },
          },
          create: { userId, githubRepositoryId: repo.githubRepositoryId, ...fields },
          update: fields,
        });
      }),
    );
  }

  return listStoredRepositories(userId);
}

export async function listStoredRepositories(userId: string): Promise<StoredRepository[]> {
  return prisma.repository.findMany({
    where: { userId },
    orderBy: [{ selected: "desc" }, { lastActivityAt: "desc" }, { fullName: "asc" }],
    select: {
      id: true,
      githubRepositoryId: true,
      owner: true,
      name: true,
      fullName: true,
      defaultBranch: true,
      private: true,
      archived: true,
      canPush: true,
      selected: true,
      htmlUrl: true,
      lastActivityAt: true,
    },
  });
}

export async function getSelectedRepository(userId: string): Promise<StoredRepository | null> {
  const repositories = await prisma.repository.findMany({
    where: { userId, selected: true },
    take: 1,
    select: {
      id: true,
      githubRepositoryId: true,
      owner: true,
      name: true,
      fullName: true,
      defaultBranch: true,
      private: true,
      archived: true,
      canPush: true,
      selected: true,
      htmlUrl: true,
      lastActivityAt: true,
    },
  });

  return repositories[0] ?? null;
}

/**
 * Marks one repository as the active target. Ownership is resolved from the
 * session user, never from a client-supplied database id.
 */
export async function selectRepository(
  userId: string,
  githubRepositoryId: string,
): Promise<StoredRepository> {
  const repository = await prisma.repository.findUnique({
    where: { userId_githubRepositoryId: { userId, githubRepositoryId } },
  });

  if (!repository) {
    throw new ApiError("NOT_FOUND", "That repository is not available on your account.");
  }

  if (repository.archived) {
    throw new ApiError("FORBIDDEN", "Archived repositories cannot be automated.");
  }

  if (!repository.canPush) {
    throw new ApiError("FORBIDDEN", "You need write access to automate this repository.");
  }

  await prisma.$transaction([
    prisma.repository.updateMany({
      where: { userId, selected: true },
      data: { selected: false },
    }),
    prisma.repository.update({
      where: { id: repository.id },
      data: { selected: true },
    }),
  ]);

  const updated = await getSelectedRepository(userId);
  if (!updated) {
    throw new ApiError("INTERNAL_ERROR", "The repository selection could not be saved.");
  }
  return updated;
}
