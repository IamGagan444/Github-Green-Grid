"use client";

import dynamic from "next/dynamic";

/**
 * The defaults form needs react-hook-form and zod (~125 KB gzip). Loading it
 * on the client after the page is interactive keeps that out of the first load.
 */
export const LazySettingsForm = dynamic(() => import("@/components/settings/settings-form").then((module) => module.SettingsForm), {
  ssr: false,
  loading: () => <div id="defaults" aria-hidden="true" className="h-80 scroll-mt-6 animate-pulse rounded-xl border border-border bg-secondary/40" />,
});
