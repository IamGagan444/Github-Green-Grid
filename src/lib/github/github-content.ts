import type { Octokit } from "octokit";
import "server-only";

import { GitHubApiError, toGitHubApiError } from "@/lib/github/errors";
import type { ActivityFileContents, ActivityFileState } from "@/lib/github/types";

const MAX_HISTORY_ENTRIES = 30;

export function createInitialActivityFile(dayKey: string): ActivityFileContents {
  return { version: 1, lastActivity: dayKey, runs: 0, history: [] };
}

/** Parses stored JSON defensively; unknown shapes are replaced, not merged. */
function parseActivityFile(raw: string, dayKey: string): ActivityFileContents {
  try {
    const parsed = JSON.parse(raw) as Partial<ActivityFileContents>;
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      lastActivity:
        typeof parsed.lastActivity === "string" ? parsed.lastActivity : dayKey,
      runs: Number.isInteger(parsed.runs) && parsed.runs !== undefined ? parsed.runs : 0,
      history: Array.isArray(parsed.history)
        ? parsed.history.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return createInitialActivityFile(dayKey);
  }
}

/**
 * Reads `.greengrid/activity.json` (or the configured path) from the default
 * branch. A missing file is not an error — the first run creates it.
 */
export async function getActivityFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  dayKey: string,
): Promise<ActivityFileState> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });

    if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string") {
      throw new GitHubApiError(
        "VALIDATION_FAILED",
        422,
        `Activity path "${path}" is not a regular file`,
      );
    }

    const decoded = Buffer.from(data.content, "base64").toString("utf8");
    return { contents: parseActivityFile(decoded, dayKey), sha: data.sha };
  } catch (error) {
    const apiError = toGitHubApiError(error, "getActivityFile");
    if (apiError.code === "NOT_FOUND") {
      return { contents: createInitialActivityFile(dayKey), sha: null };
    }
    throw apiError;
  }
}

/**
 * Produces the next state of the activity file: one run recorded for `dayKey`.
 * Pure, so the transition is unit-testable without touching GitHub.
 */
export function advanceActivityFile(
  current: ActivityFileContents,
  dayKey: string,
): ActivityFileContents {
  // History tracks distinct active days, so a schedule making many commits in
  // one day does not fill the file with repeats of the same date.
  const previous = (current.history ?? []).filter((entry) => entry !== dayKey);
  const history = [...previous, dayKey].slice(-MAX_HISTORY_ENTRIES);

  return {
    version: current.version,
    lastActivity: dayKey,
    runs: current.runs + 1,
    history,
  };
}

export function serialiseActivityFile(contents: ActivityFileContents): string {
  return `${JSON.stringify(contents, null, 2)}\n`;
}
