import {
  Activity,
  Bot,
  CalendarClock,
  FolderGit2,
  History,
  LayoutDashboard,
  MessageCircle,
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
    items: [{ href: "/dashboard", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Standup updates",
    items: [
      { href: "/automations", label: "Automations", icon: Bot },
      { href: "/executions", label: "Run history", icon: History },
    ],
  },
  {
    label: "Instagram",
    items: [{ href: "/instagram", label: "Auto-DM automations", icon: MessageCircle }],
  },
  {
    label: "Commit activity",
    items: [
      { href: "/dashboard/schedule", label: "Schedule", icon: CalendarClock },
      { href: "/dashboard/activity", label: "Activity", icon: Activity },
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
  { href: "/automations", label: "Standups", icon: Bot },
  { href: "/instagram", label: "Instagram", icon: MessageCircle },
  { href: "/dashboard/schedule", label: "Commits", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Exact match for the overview route, prefix match for everything else. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}
