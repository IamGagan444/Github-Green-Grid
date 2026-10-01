import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import "server-only";

import { auth } from "@/lib/auth/config";
import { assertPermission, AuthorizationError, type Permission } from "@/lib/rbac";
import type { UserRole, UserStatus } from "@/generated/prisma/enums";

export interface SessionUser {
  userId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: UserRole;
  status: UserStatus;
}

/**
 * Resolves the signed-in user for this request. Cached per request so layouts
 * and pages can call it freely. Returns null for anonymous or disabled users —
 * the adapter already refuses to resolve a disabled user's session.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || user.status !== "ACTIVE") return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null,
    role: user.role,
    status: user.status,
  };
});

/** Server components: anonymous (or disabled) visitors go to /login. */
export async function requireUser(permission: Permission = "dashboard:view:own"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  try {
    assertPermission(user, permission);
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === "FORBIDDEN") notFound();
    redirect("/login?error=account_disabled");
  }
  return user;
}

/** Server components under /admin. Non-admins see a 404, not a hint. */
export async function requireAdmin(permission: Permission = "admin:access"): Promise<SessionUser> {
  return requireUser(permission);
}

export function displayNameFor(user: Pick<SessionUser, "name" | "email">): string {
  return user.name?.split(" ")[0] || user.email?.split("@")[0] || "there";
}
