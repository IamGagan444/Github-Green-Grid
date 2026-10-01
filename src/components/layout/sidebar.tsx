import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { NavLink } from "@/components/layout/nav-link";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu, type UserMenuProfile } from "@/components/layout/user-menu";
import { ADMIN_SECTION, NAV_SECTIONS } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

export function Sidebar({ profile, isAdmin }: { profile: UserMenuProfile; isAdmin: boolean }) {
  const sections = isAdmin ? [...NAV_SECTIONS, ADMIN_SECTION] : NAV_SECTIONS;

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-card/40 md:flex lg:w-64">
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <Link
          href="/dashboard"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo />
        </Link>
        <ThemeToggle />
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto p-3 scrollbar-subtle">
        {sections.map((section, index) => (
          <div key={section.label ?? index} className={cn(index > 0 && "mt-4")}>
            {section.label ? (
              <p className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {section.label}
              </p>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <NavLink
                      href={item.href}
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      activeClassName="bg-secondary font-medium text-foreground"
                      inactiveClassName="text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      {item.label}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <UserMenu profile={profile} />
      </div>
    </aside>
  );
}
