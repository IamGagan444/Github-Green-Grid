import { MOBILE_NAV_ITEMS } from "@/components/layout/nav-items";
import { NavLink } from "@/components/layout/nav-link";

/** Bottom navigation shown below the md breakpoint. */
export function MobileNav() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-5">
        {MOBILE_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <NavLink
                href={item.href}
                className="flex flex-col items-center gap-1 px-1 py-2.5 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                activeClassName="text-primary"
                inactiveClassName="text-muted-foreground"
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
