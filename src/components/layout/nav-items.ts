import { Activity, CalendarClock, FolderGit2, LayoutDashboard, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/activity", label: "Activity", icon: Activity },
  { href: "/dashboard/schedule", label: "Schedule", icon: CalendarClock },
  { href: "/dashboard/repositories", label: "Repositories", icon: FolderGit2 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

/** Exact match for the overview route, prefix match for its children. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}
