import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/lib/rbac";

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const sessionDeleteMany = vi.fn();
const githubFindMany = vi.fn();
const slackFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    session: { deleteMany: (...args: unknown[]) => sessionDeleteMany(...args) },
    gitHubIntegration: { findMany: (...args: unknown[]) => githubFindMany(...args) },
    slackIntegration: { findMany: (...args: unknown[]) => slackFindMany(...args) },
    auditLog: { create: vi.fn() },
  },
}));

const { listUsers, setUserStatus, listIntegrations, getUserDetail } = await import("@/services/admin-service");

const user: Actor = { userId: "alice", role: "USER", status: "ACTIVE" };
const admin: Actor = { userId: "root", role: "ADMIN", status: "ACTIVE" };

beforeEach(() => {
  vi.clearAllMocks();
  githubFindMany.mockResolvedValue([]);
  slackFindMany.mockResolvedValue([]);
  sessionDeleteMany.mockResolvedValue({ count: 2 });
});

describe("admin services reject non-admins", () => {
  it.each([
    ["listUsers", () => listUsers(user, { page: 1, pageSize: 10 })],
    ["setUserStatus", () => setUserStatus(user, "bob", "DISABLED")],
    ["listIntegrations", () => listIntegrations(user)],
    ["getUserDetail", () => getUserDetail(user, "bob")],
  ])("%s → FORBIDDEN", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("user enable/disable", () => {
  it("disabling a user revokes every session immediately", async () => {
    userFindUnique.mockResolvedValue({ id: "bob", status: "ACTIVE" });
    await setUserStatus(admin, "bob", "DISABLED");
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "bob" }, data: { status: "DISABLED" } });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "bob" } });
  });

  it("an admin cannot disable their own account", async () => {
    await expect(setUserStatus(admin, "root", "DISABLED")).rejects.toBeTruthy();
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("admins never see OAuth tokens", () => {
  it("integration listings select no credential columns", async () => {
    await listIntegrations(admin);
    const selects = JSON.stringify([githubFindMany.mock.calls[0]?.[0].select, slackFindMany.mock.calls[0]?.[0].select]);
    expect(selects).not.toMatch(/Token|Encrypted/);
  });

  it("user detail selects no credential columns", async () => {
    userFindUnique.mockResolvedValue({ id: "bob" });
    await getUserDetail(admin, "bob");
    expect(JSON.stringify(userFindUnique.mock.calls[0]?.[0].select)).not.toMatch(/Token|Encrypted/);
  });
});
