import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GreenGrid — Keep your GitHub activity consistent",
    template: "%s · GreenGrid",
  },
  description:
    "Automate lightweight repository maintenance on your schedule using GitHub's official APIs.",
  applicationName: "GreenGrid",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#111413",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // GreenGrid ships dark-first; the token set in globals.css also defines a
    // light palette so the theme can be switched without touching components.
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Skip to content
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
