import type { ReactNode } from "react";

import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();

  const profile = {
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh">
        <Sidebar profile={profile} />

        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main" className="flex-1 pb-20 md:pb-0">
            {children}
          </main>
        </div>

        <MobileNav />
      </div>
    </TooltipProvider>
  );
}
