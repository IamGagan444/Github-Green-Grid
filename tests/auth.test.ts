import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthAdapter, type AdapterDb } from "@/lib/auth/adapter";
import { evaluateSignIn } from "@/lib/auth/sign-in-policy";
import { hashToken } from "@/lib/encryption";

describe("sign-in policy", () => {
  const base = { provider: "google", email: "dev@example.com", emailVerified: true, existingStatus: null } as const;

  it("allows a first-time Google user with a verified email", () => {
    expect(evaluateSignIn(base)).toEqual({ allowed: true });
  });

  it("allows an active returning user", () => {
    expect(evaluateSignIn({ ...base, existingStatus: "ACTIVE" })).toEqual({ allowed: true });
  });

  it("rejects disabled users", () => {
    expect(evaluateSignIn({ ...base, existingStatus: "DISABLED" })).toEqual({ allowed: false, reason: "account_disabled" });
  });

  it("rejects unverified emails and other providers", () => {
    expect(evaluateSignIn({ ...base, emailVerified: false })).toMatchObject({ allowed: false, reason: "email_unverified" });
    expect(evaluateSignIn({ ...base, email: null })).toMatchObject({ allowed: false });
    expect(evaluateSignIn({ ...base, provider: "github" })).toMatchObject({ allowed: false, reason: "provider_not_allowed" });
  });
});

describe("auth adapter", () => {
  const userCreate = vi.fn();
  const sessionCreate = vi.fn();
  const sessionFind = vi.fn();
  const sessionDeleteMany = vi.fn();
  const accountCreate = vi.fn();

  const db = {
    user: {
      create: userCreate,
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    account: { create: accountCreate, findUnique: vi.fn(), deleteMany: vi.fn() },
    session: { create: sessionCreate, findUnique: sessionFind, update: vi.fn(), deleteMany: sessionDeleteMany },
  } as unknown as AdapterDb;

  const adapter = createAuthAdapter(db);
  const activeUser = {
    id: "u1",
    name: "Dev",
    email: "dev@example.com",
    emailVerified: null,
    image: null,
    role: "USER" as const,
    status: "ACTIVE" as const,
  };

  beforeEach(() => vi.clearAllMocks());

  it("creates first-time users with role USER, ignoring any role in the input", async () => {
    userCreate.mockResolvedValue(activeUser);
    await adapter.createUser!({
      id: "ignored",
      email: "Dev@Example.com",
      emailVerified: null,
      name: "Dev",
      role: "ADMIN",
      status: "ACTIVE",
    });

    const data = userCreate.mock.calls[0]?.[0].data;
    expect(data.role).toBe("USER");
    expect(data.status).toBe("ACTIVE");
    expect(data.email).toBe("dev@example.com");
  });

  it("stores only a hash of the session token", async () => {
    await adapter.createSession!({ sessionToken: "raw-token", userId: "u1", expires: new Date(Date.now() + 1000) });
    const data = sessionCreate.mock.calls[0]?.[0].data;
    expect(data.tokenHash).toBe(hashToken("raw-token"));
    expect(JSON.stringify(data)).not.toContain("raw-token");
  });

  it("does not persist provider OAuth tokens when linking an account", async () => {
    await adapter.linkAccount!({
      userId: "u1",
      type: "oidc",
      provider: "google",
      providerAccountId: "g-1",
      access_token: "ya29.secret",
      refresh_token: "1//refresh",
      id_token: "eyJ.secret",
    });
    const data = accountCreate.mock.calls[0]?.[0].data;
    expect(data).toEqual({ userId: "u1", type: "oidc", provider: "google", providerAccountId: "g-1" });
  });

  it("resolves an active user's session", async () => {
    sessionFind.mockResolvedValue({ userId: "u1", expiresAt: new Date(Date.now() + 60_000), user: activeUser });
    const result = await adapter.getSessionAndUser!("raw-token");
    expect(result?.user).toMatchObject({ id: "u1", role: "USER", status: "ACTIVE" });
    expect(sessionFind.mock.calls[0]?.[0].where).toEqual({ tokenHash: hashToken("raw-token") });
  });

  it("refuses a disabled user's session and revokes all their sessions", async () => {
    sessionFind.mockResolvedValue({
      userId: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      user: { ...activeUser, status: "DISABLED" },
    });
    expect(await adapter.getSessionAndUser!("raw-token")).toBeNull();
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("refuses and deletes expired sessions", async () => {
    sessionFind.mockResolvedValue({ userId: "u1", expiresAt: new Date(Date.now() - 1), user: activeUser });
    expect(await adapter.getSessionAndUser!("raw-token")).toBeNull();
    expect(sessionDeleteMany).toHaveBeenCalled();
  });
});
