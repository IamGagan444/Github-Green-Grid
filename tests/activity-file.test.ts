import { describe, expect, it } from "vitest";

import {
  advanceActivityFile,
  createInitialActivityFile,
  serialiseActivityFile,
} from "@/lib/github/github-content";

describe("activity file transitions", () => {
  it("starts at zero runs", () => {
    const initial = createInitialActivityFile("2026-09-01");
    expect(initial).toEqual({
      version: 1,
      lastActivity: "2026-09-01",
      runs: 0,
      history: [],
    });
  });

  it("increments the run counter and records the day", () => {
    const next = advanceActivityFile(
      { version: 1, lastActivity: "2026-08-31", runs: 42, history: ["2026-08-31"] },
      "2026-09-01",
    );

    expect(next.runs).toBe(43);
    expect(next.lastActivity).toBe("2026-09-01");
    expect(next.history).toEqual(["2026-08-31", "2026-09-01"]);
  });

  it("preserves the schema version", () => {
    const next = advanceActivityFile(
      { version: 2, lastActivity: "2026-08-31", runs: 1 },
      "2026-09-01",
    );
    expect(next.version).toBe(2);
  });

  it("caps history growth so the file stays small", () => {
    const history = Array.from({ length: 30 }, (_, index) => "2026-01-" + String(index + 1));
    const next = advanceActivityFile(
      { version: 1, lastActivity: "2026-01-30", runs: 30, history },
      "2026-09-01",
    );

    expect(next.history).toHaveLength(30);
    expect(next.history?.at(-1)).toBe("2026-09-01");
    expect(next.history?.at(0)).toBe("2026-01-2");
  });

  it("produces stable, newline-terminated JSON", () => {
    const serialised = serialiseActivityFile({
      version: 1,
      lastActivity: "2026-09-01",
      runs: 43,
      history: [],
    });

    expect(serialised.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialised)).toEqual({
      version: 1,
      lastActivity: "2026-09-01",
      runs: 43,
      history: [],
    });
  });

  it("makes exactly one increment per call", () => {
    let state = createInitialActivityFile("2026-09-01");
    for (let index = 0; index < 5; index += 1) {
      state = advanceActivityFile(state, "2026-09-0" + (index + 1));
    }
    expect(state.runs).toBe(5);
  });
});
