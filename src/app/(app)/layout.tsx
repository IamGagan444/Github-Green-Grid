import { Suspense, type ReactNode } from "react";

import { TestPreviewHost } from "@/components/automations/test-preview-dialog";
import { MobileNav } from "@/components/layout/mobile-nav";
import { FlashToast } from "@/components/settings/flash-toast";
import { Sidebar } from "@/components/layout/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Authenticated application shell. `requireUser` runs on the server for every
 * request under this group; route handlers re-check independently.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh">
        <Sidebar profile={{ name: user.name, email: user.email, image: user.image, isAdmin }} isAdmin={isAdmin} />

        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main" className="flex-1 pb-20 md:pb-0">
            {children}
          </main>
        </div>

        <MobileNav />
      </div>
      <Suspense fallback={null}>
        <FlashToast />
      </Suspense>
      <TestPreviewHost />
    </TooltipProvider>
  );
}
