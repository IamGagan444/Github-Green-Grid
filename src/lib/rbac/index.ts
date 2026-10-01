import type { UserRole, UserStatus } from "@/generated/prisma/enums";

/**
 * Role-based access control.
 *
 * Permissions are checked server-side on every sensitive operation. The UI may
 * hide controls, but hiding is a convenience — never the enforcement point.
 *
 * Ownership rules:
 *  - `*:own` permissions apply only to resources whose `userId` equals the actor.
 *  - Admin permissions (`*:all`, `*:manage`) grant cross-user *read* and the
 *    enable/disable controls listed in the spec — they never grant editing or
 *    deleting another user's automation, and never access to OAuth tokens.
 *  - Access to a resource the actor may not see is reported as NOT_FOUND, so
 *    probing IDs cannot reveal whether another user's resource exists.
 */

export const PERMISSIONS = [
  // USER
  "dashboard:view:own",
  "automation:create:own",
  "automation:read:own",
  "automation:update:own",
  "automation:pause:own",
  "automation:delete:own",
  "automation:test:own",
  "automation:execute:own",
  "integration:github:manage:own",
  "integration:slack:manage:own",
  "execution:read:own",
  "audit:read:own",
  "settings:manage:own",
  // ADMIN
  "admin:access",
  "user:read:all",
  "user:manage",
  "automation:read:all",
  "automation:manage:all",
  "execution:read:all",
  "audit:read:all",
  "system:read",
  "integration:read:all",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const USER_PERMISSIONS: readonly Permission[] = [
  "dashboard:view:own",
  "automation:create:own",
  "automation:read:own",
  "automation:update:own",
  "automation:pause:own",
  "automation:delete:own",
  "automation:test:own",
  "automation:execute:own",
  "integration:github:manage:own",
  "integration:slack:manage:own",
  "execution:read:own",
  "audit:read:own",
  "settings:manage:own",
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...USER_PERMISSIONS,
  "admin:access",
  "user:read:all",
  "user:manage",
  "automation:read:all",
  "automation:manage:all",
  "execution:read:all",
  "audit:read:all",
  "system:read",
  "integration:read:all",
];

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  USER: new Set(USER_PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
};

export interface Actor {
  userId: string;
  role: UserRole;
  status: UserStatus;
}

export type AuthorizationErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "ACCOUNT_DISABLED";

const AUTHZ_MESSAGES: Record<AuthorizationErrorCode, string> = {
  UNAUTHORIZED: "You need to sign in to continue.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That resource could not be found.",
  ACCOUNT_DISABLED: "Your account has been disabled. Contact an administrator.",
};

export class AuthorizationError extends Error {
  readonly code: AuthorizationErrorCode;

  constructor(code: AuthorizationErrorCode, message?: string) {
    super(message ?? AUTHZ_MESSAGES[code]);
    this.name = "AuthorizationError";
    this.code = code;
  }
}

export function hasPermission(actor: Pick<Actor, "role">, permission: Permission): boolean {
  return ROLE_PERMISSIONS[actor.role]?.has(permission) ?? false;
}

/** Verifies authentication, account status, and role permission — in that order. */
export function assertPermission(actor: Actor | null | undefined, permission: Permission): Actor {
  if (!actor) throw new AuthorizationError("UNAUTHORIZED");
  if (actor.status !== "ACTIVE") throw new AuthorizationError("ACCOUNT_DISABLED");
  if (!hasPermission(actor, permission)) throw new AuthorizationError("FORBIDDEN");
  return actor;
}

/**
 * Resource-level check: the actor owns the resource (and holds `ownPermission`),
 * or holds the cross-user `adminPermission`. Anything else is NOT_FOUND.
 */
export function assertResourceAccess(
  actor: Actor | null | undefined,
  resourceOwnerId: string,
  ownPermission: Permission,
  adminPermission?: Permission,
): Actor {
  if (!actor) throw new AuthorizationError("UNAUTHORIZED");
  if (actor.status !== "ACTIVE") throw new AuthorizationError("ACCOUNT_DISABLED");

  if (resourceOwnerId === actor.userId && hasPermission(actor, ownPermission)) return actor;
  if (adminPermission && hasPermission(actor, adminPermission)) return actor;

  throw new AuthorizationError("NOT_FOUND");
}

export function isAdmin(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return actor?.role === "ADMIN";
}
