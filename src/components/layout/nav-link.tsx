"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isNavItemActive } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

/**
 * The only client part of the navigation: the active-link highlight depends on
 * the current path. The link itself works before hydration.
 */
export function NavLink({
  href,
  className,
  activeClassName,
  inactiveClassName,
  children,
}: {
  href: string;
  className: string;
  activeClassName: string;
  inactiveClassName: string;
  children: React.ReactNode;
}) {
  const active = isNavItemActive(usePathname(), href);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn(className, active ? activeClassName : inactiveClassName)}>
      {children}
    </Link>
  );
}
