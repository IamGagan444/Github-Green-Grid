import { describe, expect, it } from "vitest";

import { filterAuthoredCommits, sanitiseCommitMessage } from "@/lib/github/commit-filter";
import type { CommitQuery, RawCommit } from "@/lib/github/types";

const query: CommitQuery = {
  authorLogin: "gagan",
  authorId: "42",
  // 2026-09-30 in Asia/Kolkata = [2026-09-29T18:30Z, 2026-09-30T18:30Z)
  since: new Date("2026-09-29T18:30:00Z"),
  until: new Date("2026-09-30T18:30:00Z"),
};

function raw(overrides: Partial<RawCommit> & { date?: string } = {}): RawCommit {
  const { date = "2026-09-30T06:00:00Z", ...rest } = overrides;
  return {
    sha: Math.random().toString(16).slice(2).padEnd(40, "a"),
    html_url: "https://github.com/acme/api/commit/abc",
    parents: [{ sha: "p1" }],
    author: { login: "gagan", id: 42 },
    commit: { message: "Add retry with backoff", author: { date }, committer: { date } },
    ...rest,
  };
}

const wrap = (commits: RawCommit[], branch: string | null = "main") =>
  commits.map((commit) => ({ raw: commit, branch, repository: "acme/api" }));

describe("filterAuthoredCommits", () => {
  it("keeps the connected user's commits inside the local day", () => {
    const result = filterAuthoredCommits(wrap([raw()]), query);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ repository: "acme/api", branch: "main", message: "Add retry with backoff" });
  });

  it("drops commits by other authors, and commits with no linked GitHub user", () => {
    const result = filterAuthoredCommits(
      wrap([raw({ author: { login: "someone-else", id: 7 } }), raw({ author: null })]),
      query,
    );
    expect(result).toHaveLength(0);
  });

  it("matches the numeric user id even after a username change", () => {
    const result = filterAuthoredCommits(wrap([raw({ author: { login: "old-name", id: 42 } })]), query);
    expect(result).toHaveLength(1);
  });

  it("applies the timezone-derived window with an inclusive start and exclusive end", () => {
    const result = filterAuthoredCommits(
      wrap([
        raw({ date: "2026-09-29T18:29:59Z" }), // 23:59:59 IST on the 29th → excluded
        raw({ date: "2026-09-29T18:30:00Z" }), // 00:00 IST on the 30th → included
        raw({ date: "2026-09-30T18:29:59Z" }), // 23:59:59 IST → included
        raw({ date: "2026-09-30T18:30:00Z" }), // next day → excluded
      ]),
      query,
    );
    expect(result.map((commit) => commit.authoredAt)).toEqual([
      "2026-09-29T18:30:00.000Z",
      "2026-09-30T18:29:59.000Z",
    ]);
  });

  it("drops merge commits and deduplicates the same SHA seen on several branches", () => {
    const shared = raw();
    const result = filterAuthoredCommits(
      [
        ...wrap([shared], "main"),
        ...wrap([shared], "feature/x"),
        ...wrap([raw({ parents: [{ sha: "a" }, { sha: "b" }] })]),
      ],
      query,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.branch).toBe("main");
  });

  it("returns commits oldest first and ignores non-GitHub URLs", () => {
    const result = filterAuthoredCommits(
      wrap([
        raw({ date: "2026-09-30T10:00:00Z", html_url: "javascript:alert(1)" }),
        raw({ date: "2026-09-30T05:00:00Z" }),
      ]),
      query,
    );
    expect(result.map((commit) => commit.authoredAt)).toEqual(["2026-09-30T05:00:00.000Z", "2026-09-30T10:00:00.000Z"]);
    expect(result[1]?.url).toBeNull();
  });
});

describe("sanitiseCommitMessage", () => {
  it("strips control characters but keeps newlines, and bounds length", () => {
    expect(sanitiseCommitMessage("fix\u0000 bug\u001b[31m\nbody")).toBe("fix bug[31m\nbody");
    expect(sanitiseCommitMessage("x".repeat(5000))).toHaveLength(1000);
  });
});
