"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface UserMenuProfile {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export function UserMenu({ profile }: { profile: UserMenuProfile }) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  async function signOut() {
    setIsSigningOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout failed");
      router.replace("/");
      router.refresh();
    } catch {
      toast.error("Could not sign out. Please try again.");
      setIsSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={"Account menu for " + profile.username}
      >
        <Avatar profile={profile} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{profile.username}</span>
          {profile.displayName ? (
            <span className="block truncate text-xs text-muted-foreground">
              {profile.displayName}
            </span>
          ) : null}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Signed in as {profile.username}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings">
            <Settings aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
          disabled={isSigningOut}
        >
          <LogOut aria-hidden="true" />
          {isSigningOut ? "Signing out…" : "Log out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Avatar({ profile }: { profile: UserMenuProfile }) {
  if (!profile.avatarUrl) {
    return (
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium"
      >
        {profile.username.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <Image
      src={profile.avatarUrl}
      alt=""
      width={28}
      height={28}
      className="size-7 shrink-0 rounded-full border border-border"
    />
  );
}
