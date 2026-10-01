import {
  Activity,
  Bot,
  CalendarClock,
  FolderGit2,
  History,
  LayoutDashboard,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/automations", label: "Standup automations", icon: Bot },
      { href: "/executions", label: "Executions", icon: History },
    ],
  },
  {
    label: "Commit activity",
    items: [
      { href: "/dashboard/activity", label: "Activity", icon: Activity },
      { href: "/dashboard/schedule", label: "Schedule", icon: CalendarClock },
      { href: "/dashboard/repositories", label: "Repositories", icon: FolderGit2 },
    ],
  },
  {
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

export const ADMIN_SECTION: NavSection = {
  label: "Administration",
  items: [{ href: "/admin", label: "Admin", icon: ShieldCheck }],
};

/** Bottom navigation on small screens: the five most used destinations. */
export const MOBILE_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/automations", label: "Automations", icon: Bot },
  { href: "/executions", label: "Runs", icon: History },
  { href: "/dashboard/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Exact match for the overview route, prefix match for everything else. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}
