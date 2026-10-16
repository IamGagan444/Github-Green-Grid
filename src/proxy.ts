import { NextResponse, type NextRequest } from "next/server";

import { buildContentSecurityPolicy, createNonce, NONCE_HEADER } from "@/lib/security/csp";

/**
 * Adds a nonce-based Content-Security-Policy to every page. Next.js reads the
 * policy from the request headers and puts the nonce on its own inline
 * scripts; the root layout reads `x-nonce` for the theme script.
 *
 * API routes, webhooks and static files are excluded (they return no HTML).
 */
export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|favicon|apple-touch-icon|site.webmanifest|.*\\.(?:png|jpg|jpeg|svg|ico|webp|txt|xml)$).*)",
      // Prefetches render no new HTML document; they reuse the page's policy.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
