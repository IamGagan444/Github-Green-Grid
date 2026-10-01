import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Automatic memoization of components, callbacks and derived values.
  reactCompiler: true,
  poweredByHeader: false,
  experimental: {
    // Reuse a visited page's server render for 60s on client navigation, so
    // switching back and forth is instant. Server Actions (revalidatePath) and
    // router.refresh() still invalidate it immediately after a change.
    staleTimes: { dynamic: 60, static: 300 },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
