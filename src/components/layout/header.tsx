import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { getCurrentUser } from "@/lib/auth/session";

interface HeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional breadcrumb-style link rendered above the title. */
  back?: { href: string; label: string };
}

export async function Header({ title, description, actions, back }: HeaderProps) {
  const user = await getCurrentUser();

  return (
    <>
      {/* Compact bar with the logo and account menu, mobile only. */}
      <div className="flex h-14 items-center justify-between gap-3 border-b border-border px-4 md:hidden">
        <Link
          href="/dashboard"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {user ? (
            <div className="w-40">
              <UserMenu
                profile={{ name: user.name, email: user.email, image: user.image, isAdmin: user.role === "ADMIN" }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b border-border px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between md:py-6">
        <div className="min-w-0">
          {back ? (
            <Link
              href={back.href}
              className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground"
            >
              ← {back.label}
            </Link>
          ) : null}
          <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </>
  );
}
