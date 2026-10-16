import tls from "node:tls";

import type { MonitorState } from "@/generated/prisma/enums";
import { hubMessage, md, type HubMessage } from "@/lib/hub/message";
import { assertPublicUrl, safeFetch, type SafeFetchOptions } from "@/lib/net/safe-fetch";

/**
 * Uptime checks. Alerts fire only on a state change (UP → DOWN, DOWN → UP):
 * a site that stays down produces one alert, not one every 15 minutes.
 */

export const CHECK_INTERVAL_MS = 15 * 60_000;
export const CHECK_TIMEOUT_MS = 10_000;
/** One quick re-check before declaring a site down filters out blips. */
export const CONFIRM_DELAY_MS = 3_000;
export const TLS_ALERT_DAYS = [14, 3] as const;

export interface CheckResult {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
}

export type StateChange = "down" | "up" | null;

export interface Transition {
  state: MonitorState;
  consecutiveFailures: number;
  change: StateChange;
}

export function evaluateCheck(previous: { state: MonitorState; consecutiveFailures: number }, result: CheckResult): Transition {
  if (result.ok) {
    return { state: "UP", consecutiveFailures: 0, change: previous.state === "DOWN" ? "up" : null };
  }
  // The first check of a new monitor counts: a URL that is down from the start is worth knowing about.
  return {
    state: "DOWN",
    consecutiveFailures: previous.consecutiveFailures + 1,
    change: previous.state === "DOWN" ? null : "down",
  };
}

/** HEAD first (cheap); fall back to GET for servers that refuse HEAD. 2xx and 3xx are "up". */
export async function checkUrl(url: string, options: Pick<SafeFetchOptions, "fetchImpl" | "resolver"> = {}): Promise<CheckResult> {
  const started = Date.now();
  const attempt = async (method: "HEAD" | "GET") =>
    safeFetch(url, {
      ...options,
      method,
      timeoutMs: CHECK_TIMEOUT_MS,
      followRedirects: false,
      maxBytes: 64 * 1024,
      headers: { "User-Agent": "GreenGrid-Uptime/1.0 (+https://github.com/IamGagan444/greengrid)" },
    });

  try {
    let response = await attempt("HEAD");
    if (response.status === 405 || response.status === 501 || response.status === 403) response = await attempt("GET");
    return {
      ok: response.status < 400,
      statusCode: response.status,
      latencyMs: Date.now() - started,
      error: response.status < 400 ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return {
      ok: false,
      statusCode: null,
      latencyMs: Date.now() - started,
      error: code === "TIMEOUT" ? "Timed out after 10s" : code === "BLOCKED" ? "Address not allowed" : "Unreachable",
    };
  }
}

/**
 * Which TLS alert (if any) is due. `alerted` is the smallest threshold already
 * sent for this certificate; a renewed certificate (more than 14 days left)
 * resets it to null.
 */
export function tlsAlertDue(daysLeft: number, alerted: number | null): { alert: number | null; level: number | null } {
  if (daysLeft > TLS_ALERT_DAYS[0]) return { alert: null, level: null };
  const threshold = [...TLS_ALERT_DAYS].reverse().find((days) => daysLeft <= days) ?? null;
  if (threshold === null) return { alert: null, level: alerted };
  if (alerted !== null && alerted <= threshold) return { alert: null, level: alerted };
  return { alert: threshold, level: threshold };
}

/** Reads the certificate's notAfter. The host is validated as public first, then dialled by address. */
export async function getCertificateExpiry(rawUrl: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<Date | null> {
  const url = await assertPublicUrl(rawUrl, { httpsOnly: true });
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port || 443);

  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      const expiry = certificate?.valid_to ? new Date(certificate.valid_to) : null;
      resolve(expiry && !Number.isNaN(expiry.getTime()) ? expiry : null);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
    socket.on("error", () => resolve(null));
  });
}

export function uptimeMessage(
  monitor: { label: string; url: string },
  change: Exclude<StateChange, null>,
  result: CheckResult,
): HubMessage {
  const down = change === "down";
  return hubMessage({
    title: down ? `${monitor.label} is down` : `${monitor.label} is back up`,
    body: [
      md.text(monitor.url, 300),
      down
        ? `${md.bold("Error:")} ${md.text(result.error ?? "Unknown error", 120)}`
        : `Responded ${md.code(String(result.statusCode ?? "OK"))} in ${result.latencyMs} ms`,
    ].join("\n"),
    buttons: [{ label: "Open site", url: monitor.url }],
    severity: down ? "critical" : "success",
  });
}

export function tlsMessage(monitor: { label: string; url: string }, expiresAt: Date, daysLeft: number): HubMessage {
  return hubMessage({
    title: `TLS certificate for ${monitor.label} expires in ${Math.max(daysLeft, 0)} day${daysLeft === 1 ? "" : "s"}`,
    body: `${md.text(monitor.url, 300)}\nExpires ${md.code(expiresAt.toISOString().slice(0, 10))}. Renew it before visitors see a security warning.`,
    severity: daysLeft <= 3 ? "critical" : "warning",
  });
}
