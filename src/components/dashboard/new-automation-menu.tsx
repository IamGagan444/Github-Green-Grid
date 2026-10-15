"use client";

import Link from "next/link";
import { Bot, CalendarClock, ChevronDown, MessageCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  {
    href: "/automations/new",
    icon: Bot,
    label: "Standup update",
    description: "Commits → AI summary → Slack",
  },
  {
    href: "/instagram/new",
    icon: MessageCircle,
    label: "Instagram auto-DM",
    description: "Comment keyword → DM a link",
  },
  {
    href: "/dashboard/schedule",
    icon: CalendarClock,
    label: "Commit activity",
    description: "Scheduled repository maintenance",
  },
];

/** One entry point for every automation type. */
export function NewAutomationMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          New automation
          <ChevronDown className="opacity-70" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>What do you want to automate?</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenuItem key={option.href} asChild className="cursor-pointer items-start gap-3 py-2">
              <Link href={option.href}>
                <Icon className="mt-0.5 size-4" aria-hidden="true" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
