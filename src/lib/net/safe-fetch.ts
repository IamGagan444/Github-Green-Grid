import dns from "node:dns/promises";
import net from "node:net";

/**
 * Outbound HTTP for user-supplied URLs (uptime checks, RSS feeds, AI base
 * URLs). Every hop is checked before it is requested:
 *
 *   - http(s) only, no credentials in the URL;
 *   - the host must resolve exclusively to public addresses — loopback,
 *     private, link-local (cloud metadata), CGNAT, multicast and reserved
 *     ranges are refused, for IPv4, IPv6 and IPv4-mapped IPv6;
 *   - redirects are followed manually (at most `maxRedirects`), each target
 *     re-validated, so a public URL cannot bounce the request inward;
 *   - a hard timeout covers the whole exchange and the body is capped.
 *
 * Residual risk: `fetch` resolves the host again after our lookup, so a DNS
 * record with a very short TTL could change in between (rebinding). The
 * window is milliseconds and responses are never returned to the requester
 * verbatim, which keeps this acceptable for these features.
 */

export type SafeFetchErrorCode =
  | "INVALID_URL"
  | "BLOCKED"
  | "TIMEOUT"
  | "NETWORK"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isBlockedV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Expands an IPv6 address to eight 16-bit groups. */
function expandV6(ip: string): number[] | null {
  let address = ip.toLowerCase();
  const zone = address.indexOf("%");
  if (zone !== -1) address = address.slice(0, zone);

  // Trailing dotted IPv4 (e.g. ::ffff:10.0.0.1).
  const lastColon = address.lastIndexOf(":");
  const tail = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (net.isIPv4(tail) === false) return null;
    const value = ipv4ToInt(tail);
    address = `${address.slice(0, lastColon + 1)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const [head = "", rest] = address.split("::");
  const headParts = head ? head.split(":") : [];
  const restParts = rest !== undefined && rest !== "" ? rest.split(":") : [];
  const missing = 8 - headParts.length - restParts.length;
  if (rest === undefined && headParts.length !== 8) return null;
  if (missing < 0) return null;

  const groups = [...headParts, ...Array<string>(rest === undefined ? 0 : missing).fill("0"), ...restParts].map(
    (part) => Number.parseInt(part, 16),
  );
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

function isBlockedV6(ip: string): boolean {
  const groups = expandV6(ip);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];

  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && g7 === 1) return true; // ::1

  const embeddedV4 = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d).
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return isBlockedV4(embeddedV4);
  }
  // NAT64 well-known prefix 64:ff9b::/96.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isBlockedV4(embeddedV4);

  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2002) return isBlockedV4(`${g1 >> 8}.${g1 & 0xff}.${g2 >> 8}.${g2 & 0xff}`); // 6to4
  return false;
}

/** True for any address a server-side request must never reach. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedV4(ip);
  if (net.isIPv6(ip)) return isBlockedV6(ip);
  return true;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

/** Parses and validates a URL, resolving its host. Throws SafeFetchError("BLOCKED"/"INVALID_URL"). */
export async function assertPublicUrl(
  raw: string,
  options: { resolver?: Resolver; httpsOnly?: boolean } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("INVALID_URL", "not a valid URL");
  }

  if (url.protocol !== "https:" && (options.httpsOnly || url.protocol !== "http:")) {
    throw new SafeFetchError("INVALID_URL", "only http(s) URLs are allowed");
  }
  if (url.username || url.password) throw new SafeFetchError("INVALID_URL", "credentials in URLs are not allowed");

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) throw new SafeFetchError("INVALID_URL", "missing host");
  if (hostname === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new SafeFetchError("BLOCKED", "host is not public");
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new SafeFetchError("BLOCKED", "address is not public");
    return url;
  }

  let addresses: string[];
  try {
    addresses = await (options.resolver ?? defaultResolver)(hostname);
  } catch {
    throw new SafeFetchError("NETWORK", "host could not be resolved");
  }
  if (addresses.length === 0) throw new SafeFetchError("NETWORK", "host has no addresses");
  if (addresses.some(isPrivateAddress)) throw new SafeFetchError("BLOCKED", "host resolves to a non-public address");
  return url;
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** false returns a 3xx response as-is instead of following it. */
  followRedirects?: boolean;
  httpsOnly?: boolean;
  resolver?: Resolver;
  fetchImpl?: typeof fetch;
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  /** Final URL after redirects. */
  url: string;
  headers: Headers;
  body: Buffer;
  text(): string;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeFetchError("TOO_LARGE", "response exceeds size limit");
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SafeFetchError("TOO_LARGE", "response exceeds size limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Fetches a user-supplied URL under the rules described above. */
export async function safeFetch(raw: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRedirects = options.maxRedirects ?? 3;
  let method = options.method ?? "GET";
  let body = options.body;
  let current = raw;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = await assertPublicUrl(current, { resolver: options.resolver, httpsOnly: options.httpsOnly });

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: options.headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        redirect: "manual",
        cache: "no-store",
        signal,
      });
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "TimeoutError")) {
        throw new SafeFetchError("TIMEOUT", "request timed out");
      }
      throw new SafeFetchError("NETWORK", "request failed");
    }

    const location = response.headers.get("location");
    if (REDIRECT_STATUSES.has(response.status) && location && options.followRedirects !== false) {
      await response.body?.cancel().catch(() => undefined);
      current = new URL(location, url).toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = method === "HEAD" ? Buffer.alloc(0) : await readCapped(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      if (signal.aborted) throw new SafeFetchError("TIMEOUT", "request timed out");
      throw new SafeFetchError("NETWORK", "response could not be read");
    }

    return {
      status: response.status,
      ok: response.ok,
      url: url.toString(),
      headers: response.headers,
      body: buffer,
      text: () => buffer.toString("utf8"),
    };
  }

  throw new SafeFetchError("TOO_MANY_REDIRECTS", "too many redirects");
}
