import { describe, expect, it } from "vitest";

import { matchRule, parseRuleFilter } from "@/lib/hub/rules";

const prOpened = { source: "GITHUB" as const, type: "pull_request.opened", attrs: { repository: "acme/web" } };

describe("notification rule matching", () => {
  it("matches GitHub events by type and repository", () => {
    const rule = { source: "GITHUB" as const, filter: { events: ["pull_request.opened"], repositories: ["acme/web"] } };
    expect(matchRule(rule, prOpened)).toBe(true);
    expect(matchRule(rule, { ...prOpened, type: "issues.opened" })).toBe(false);
    expect(matchRule(rule, { ...prOpened, attrs: { repository: "acme/api" } })).toBe(false);
  });

  it("an empty repository list means every repository; names compare case-insensitively", () => {
    expect(matchRule({ source: "GITHUB", filter: { events: ["pull_request.opened"] } }, prOpened)).toBe(true);
    expect(
      matchRule({ source: "GITHUB", filter: { events: ["pull_request.opened"], repositories: ["Acme/Web"] } }, prOpened),
    ).toBe(true);
  });

  it("never matches across sources", () => {
    expect(matchRule({ source: "UPTIME", filter: { events: ["uptime.down"] } }, prOpened)).toBe(false);
  });

  it("filters uptime events by monitor", () => {
    const rule = { source: "UPTIME" as const, filter: { events: ["uptime.down", "uptime.up"], monitorIds: ["m1"] } };
    expect(matchRule(rule, { source: "UPTIME", type: "uptime.down", attrs: { monitorId: "m1" } })).toBe(true);
    expect(matchRule(rule, { source: "UPTIME", type: "uptime.down", attrs: { monitorId: "m2" } })).toBe(false);
    expect(matchRule(rule, { source: "UPTIME", type: "uptime.tls_expiring", attrs: { monitorId: "m1" } })).toBe(false);
  });

  it("a corrupt stored filter matches nothing instead of everything", () => {
    expect(matchRule({ source: "GITHUB", filter: { events: [] } }, prOpened)).toBe(false);
    expect(matchRule({ source: "GITHUB", filter: "garbage" }, prOpened)).toBe(false);
  });

  it("validates filters on write", () => {
    expect(() => parseRuleFilter("GITHUB", { events: ["push"] })).toThrow();
    expect(() => parseRuleFilter("GITHUB", { events: ["release.published"], repositories: ["not a repo"] })).toThrow();
    expect(parseRuleFilter("GITHUB", { events: ["release.published"], repositories: ["Acme/Web"] })).toEqual({
      events: ["release.published"],
      repositories: ["acme/web"],
    });
  });
});
