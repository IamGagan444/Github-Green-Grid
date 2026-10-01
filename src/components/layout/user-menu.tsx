"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronsUpDown, LogOut, Settings, ShieldCheck } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface UserMenuProfile {
  name: string | null;
  email: string | null;
  image: string | null;
  isAdmin?: boolean;
}

function labelFor(profile: UserMenuProfile): string {
  return profile.name || profile.email || "Account";
}

export function UserMenu({ profile }: { profile: UserMenuProfile }) {
  const label = labelFor(profile);
  const signOutFormRef = React.useRef<HTMLFormElement>(null);

  return (
    <>
      {/* Outside the menu: selecting an item closes (unmounts) the menu before a
        form inside it could submit, and browsers don't submit detached forms. */}
      <form ref={signOutFormRef} action={signOutAction} hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={"Account menu for " + label}
        >
          <Avatar profile={profile} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{label}</span>
            {profile.email && profile.name ? (
              <span className="block truncate text-xs text-muted-foreground">
                {profile.email}
              </span>
            ) : null}
          </span>
          <ChevronsUpDown
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="truncate">
            Signed in as {profile.email ?? label}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings aria-hidden="true" />
              Settings
            </Link>
          </DropdownMenuItem>
          {profile.isAdmin ? (
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <ShieldCheck aria-hidden="true" />
                Admin
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => signOutFormRef.current?.requestSubmit()}
          >
            <LogOut aria-hidden="true" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function Avatar({
  profile,
  size = 28,
}: {
  profile: UserMenuProfile;
  size?: number;
}) {
  if (!profile.image) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium"
      >
        {labelFor(profile).slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <Image
      src={profile.image}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full border border-border"
    />
  );
}
