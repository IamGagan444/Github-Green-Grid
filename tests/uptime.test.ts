import { describe, expect, it } from "vitest";

import { checkUrl, evaluateCheck, tlsAlertDue, type CheckResult } from "@/lib/uptime/monitor";

const up: CheckResult = { ok: true, statusCode: 200, latencyMs: 120, error: null };
const down: CheckResult = { ok: false, statusCode: 503, latencyMs: 80, error: "HTTP 503" };

describe("uptime state changes", () => {
  it("alerts once when a site goes down, not on every failed check", () => {
    const first = evaluateCheck({ state: "UP", consecutiveFailures: 0 }, down);
    expect(first).toEqual({ state: "DOWN", consecutiveFailures: 1, change: "down" });
    const second = evaluateCheck({ state: first.state, consecutiveFailures: first.consecutiveFailures }, down);
    expect(second.change).toBeNull();
    expect(second.consecutiveFailures).toBe(2);
  });

  it("alerts when it comes back up", () => {
    expect(evaluateCheck({ state: "DOWN", consecutiveFailures: 4 }, up)).toEqual({ state: "UP", consecutiveFailures: 0, change: "up" });
  });

  it("a new monitor that is up stays quiet; one that starts down alerts", () => {
    expect(evaluateCheck({ state: "UNKNOWN", consecutiveFailures: 0 }, up).change).toBeNull();
    expect(evaluateCheck({ state: "UNKNOWN", consecutiveFailures: 0 }, down).change).toBe("down");
  });

  it("staying up never alerts", () => {
    expect(evaluateCheck({ state: "UP", consecutiveFailures: 0 }, up).change).toBeNull();
  });
});

describe("TLS expiry thresholds", () => {
  it("alerts at 14 days, then again at 3, and only once each", () => {
    expect(tlsAlertDue(30, null)).toEqual({ alert: null, level: null });
    expect(tlsAlertDue(14, null)).toEqual({ alert: 14, level: 14 });
    expect(tlsAlertDue(10, 14)).toEqual({ alert: null, level: 14 });
    expect(tlsAlertDue(3, 14)).toEqual({ alert: 3, level: 3 });
    expect(tlsAlertDue(1, 3)).toEqual({ alert: null, level: 3 });
  });

  it("a renewed certificate resets the alerts", () => {
    expect(tlsAlertDue(89, 3)).toEqual({ alert: null, level: null });
  });

  it("a certificate first seen with 2 days left alerts at the 3-day level", () => {
    expect(tlsAlertDue(2, null)).toEqual({ alert: 3, level: 3 });
  });
});

describe("checkUrl", () => {
  const publicResolver = async () => ["93.184.216.34"];

  it("treats redirects as up and falls back to GET when HEAD is refused", async () => {
    const methods: string[] = [];
    const fetchImpl = (async (_url: URL, init: RequestInit) => {
      methods.push(init.method ?? "GET");
      return init.method === "HEAD" ? new Response(null, { status: 405 }) : new Response(null, { status: 301, headers: { location: "/home" } });
    }) as unknown as typeof fetch;

    const result = await checkUrl("https://example.com", { fetchImpl, resolver: publicResolver });
    expect(methods).toEqual(["HEAD", "GET"]);
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(301);
  });

  it("reports private addresses as unreachable without requesting them", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response(null);
    }) as unknown as typeof fetch;
    const result = await checkUrl("http://internal.example", { fetchImpl, resolver: async () => ["10.0.0.5"] });
    expect(called).toBe(false);
    expect(result).toMatchObject({ ok: false, error: "Address not allowed" });
  });
});
