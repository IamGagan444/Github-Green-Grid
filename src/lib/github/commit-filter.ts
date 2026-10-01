import type { AuthoredCommit, CommitQuery, RawCommit } from "@/lib/github/types";

const MAX_MESSAGE_LENGTH = 1_000;

/** Removes control characters (except newline/tab) and bounds length. */
export function sanitiseCommitMessage(message: string): string {
  let cleaned = "";
  for (const character of message) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x09 || (code >= 0x20 && code !== 0x7f)) cleaned += character;
  }
  return cleaned.trim().slice(0, MAX_MESSAGE_LENGTH);
}

function commitTimestamp(raw: RawCommit): Date | null {
  const value = raw.commit?.author?.date ?? raw.commit?.committer?.date;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isAuthoredBy(raw: RawCommit, query: CommitQuery): boolean {
  const login = raw.author?.login?.toLowerCase();
  if (login && login === query.authorLogin.toLowerCase()) return true;
  if (query.authorId && raw.author?.id !== undefined && String(raw.author.id) === query.authorId) {
    return true;
  }
  return false;
}

/**
 * Pure filter applied to every commit GitHub returns:
 *  - authored by the connected GitHub user (login or numeric id),
 *  - authored inside [since, until),
 *  - not a merge commit,
 *  - deduplicated by SHA.
 * Output is sorted oldest first so the AI reads work in order.
 */
export function filterAuthoredCommits(
  candidates: Array<{ raw: RawCommit; branch: string | null; repository: string }>,
  query: CommitQuery,
): AuthoredCommit[] {
  const seen = new Set<string>();
  const result: AuthoredCommit[] = [];

  for (const { raw, branch, repository } of candidates) {
    if (!raw?.sha || seen.has(raw.sha)) continue;
    if (!isAuthoredBy(raw, query)) continue;
    if ((raw.parents?.length ?? 0) > 1) continue;

    const at = commitTimestamp(raw);
    if (!at || at.getTime() < query.since.getTime() || at.getTime() >= query.until.getTime()) continue;

    const message = sanitiseCommitMessage(raw.commit?.message ?? "");
    if (!message) continue;

    seen.add(raw.sha);
    result.push({
      sha: raw.sha,
      repository,
      branch,
      message,
      url: typeof raw.html_url === "string" && raw.html_url.startsWith("https://github.com/") ? raw.html_url : null,
      authoredAt: at.toISOString(),
      stats: null,
    });
  }

  return result.sort((a, b) => a.authoredAt.localeCompare(b.authoredAt));
}
