import type { Metadata, Viewport } from "next";

import { THEME_INIT_SCRIPT } from "@/components/layout/theme-script";
import { QueryProvider } from "@/components/providers/query-provider";
import { StoreProvider } from "@/components/providers/store-provider";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GreenGrid — GitHub activity and daily standups, automated",
    template: "%s · GreenGrid",
  },
  description:
    "Turn your GitHub commits into AI-written daily standup updates in Slack, and automate lightweight repository maintenance.",
  applicationName: "GreenGrid",
  robots: { index: true, follow: true },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#111413",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme class is set before paint by THEME_INIT_SCRIPT (stored choice,
    // else OS preference); suppressHydrationWarning covers that attribute.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <StoreProvider>
          <QueryProvider>{children}</QueryProvider>
        </StoreProvider>
        <Toaster />
      </body>
    </html>
  );
}
