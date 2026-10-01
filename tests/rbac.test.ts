import { describe, expect, it } from "vitest";

import {
  assertPermission,
  assertResourceAccess,
  AuthorizationError,
  hasPermission,
  type Actor,
} from "@/lib/rbac";

const alice: Actor = { userId: "alice", role: "USER", status: "ACTIVE" };
const bob: Actor = { userId: "bob", role: "USER", status: "ACTIVE" };
const admin: Actor = { userId: "root", role: "ADMIN", status: "ACTIVE" };
const disabled: Actor = { userId: "carol", role: "USER", status: "DISABLED" };

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof AuthorizationError ? error.code : "OTHER";
  }
}

describe("role permissions", () => {
  it("gives users only self-service permissions", () => {
    expect(hasPermission(alice, "automation:create:own")).toBe(true);
    expect(hasPermission(alice, "integration:slack:manage:own")).toBe(true);
    expect(hasPermission(alice, "admin:access")).toBe(false);
    expect(hasPermission(alice, "user:manage")).toBe(false);
    expect(hasPermission(alice, "execution:read:all")).toBe(false);
  });

  it("gives admins the admin permissions plus their own self-service", () => {
    for (const permission of [
      "admin:access",
      "user:read:all",
      "user:manage",
      "automation:read:all",
      "automation:manage:all",
      "execution:read:all",
      "audit:read:all",
      "system:read",
      "integration:read:all",
      "automation:create:own",
    ] as const) {
      expect(hasPermission(admin, permission)).toBe(true);
    }
  });
});

describe("assertPermission", () => {
  it("checks authentication, then status, then role", () => {
    expect(codeOf(() => assertPermission(null, "dashboard:view:own"))).toBe("UNAUTHORIZED");
    expect(codeOf(() => assertPermission(disabled, "dashboard:view:own"))).toBe("ACCOUNT_DISABLED");
    expect(codeOf(() => assertPermission(alice, "admin:access"))).toBe("FORBIDDEN");
    expect(codeOf(() => assertPermission(admin, "admin:access"))).toBeNull();
  });

  it("blocks a disabled admin too", () => {
    expect(codeOf(() => assertPermission({ ...admin, status: "DISABLED" }, "admin:access"))).toBe("ACCOUNT_DISABLED");
  });
});

describe("assertResourceAccess (IDOR protection)", () => {
  it("lets owners access their own resources", () => {
    expect(codeOf(() => assertResourceAccess(alice, "alice", "automation:read:own", "automation:read:all"))).toBeNull();
  });

  it("reports another user's resource as NOT_FOUND, not FORBIDDEN", () => {
    expect(codeOf(() => assertResourceAccess(bob, "alice", "automation:read:own", "automation:read:all"))).toBe("NOT_FOUND");
  });

  it("allows admins cross-user access only where an admin permission is given", () => {
    expect(codeOf(() => assertResourceAccess(admin, "alice", "automation:read:own", "automation:read:all"))).toBeNull();
    // No admin permission offered for this operation → admins are treated like anyone else.
    expect(codeOf(() => assertResourceAccess(admin, "alice", "automation:update:own"))).toBe("NOT_FOUND");
  });
});
