/**
 * Content-Security-Policy for HTML responses. Scripts run only with the
 * per-request nonce ('strict-dynamic' lets those scripts load Next's chunks),
 * so an injected <script> or inline handler cannot execute even if some text
 * ever escaped React's escaping.
 *
 * Styles allow 'unsafe-inline': Tailwind and React `style` attributes need it,
 * and inline styles cannot run code.
 */

export const NONCE_HEADER = "x-nonce";

/** Hosts images are loaded from (avatars, Instagram post thumbnails). */
const IMAGE_HOSTS = [
  "https://avatars.githubusercontent.com",
  "https://lh3.googleusercontent.com",
  "https://*.cdninstagram.com",
  "https://*.fbcdn.net",
];

export function buildContentSecurityPolicy(nonce: string, options: { development: boolean }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-eval' only in development: React's dev tooling needs it.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(options.development ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...IMAGE_HOSTS],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(options.development ? ["ws:", "wss:"] : [])],
    "frame-ancestors": ["'none'"],
    // Sign-in without JavaScript posts to us and is redirected to Google.
    "form-action": ["'self'", "https://accounts.google.com"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "manifest-src": ["'self'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!options.development) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** 128 bits of randomness, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
