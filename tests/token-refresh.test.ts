import crypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_KEY = crypto.randomBytes(32).toString("base64");

beforeAll(() => {
  process.env.GITHUB_TOKEN_ENCRYPTION_KEY = TEST_KEY;
});

const accountFindUnique = vi.fn();
const accountUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubAccount: {
      findUnique: (...args: unknown[]) => accountFindUnique(...args),
      update: (...args: unknown[]) => accountUpdate(...args),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
  }),
  getAppUrl: () => "https://example.test",
  isProduction: () => false,
}));

const { encryptSecret, decryptSecret } = await import("@/lib/encryption");
const { getGitHubClient } = await import("@/lib/github/github-client");

const ACCESS_TOKEN = "gho_original_access_token";
const REFRESH_TOKEN = "ghr_original_refresh_token";
const NEW_ACCESS_TOKEN = "gho_rotated_access_token";
const NEW_REFRESH_TOKEN = "ghr_rotated_refresh_token";

/** Minutes from now, as a Date. */
function inMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function mockTokenEndpoint(body: Record<string, unknown>, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  accountUpdate.mockResolvedValue({});
});

describe("getGitHubClient token lifecycle", () => {
  it("does not refresh a non-expiring token", async () => {
    const fetchMock = mockTokenEndpoint({});
    vi.stubGlobal("fetch", fetchMock);

    accountFindUnique.mockResolvedValue({
      accessTokenEncrypted: encryptSecret(ACCESS_TOKEN),
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
    });

    await getGitHubClient("user_1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(accountUpdate).not.toHaveBeenCalled();
  });

  it("does not refresh a token that is still comfortably valid", async () => {
    const fetchMock = mockTokenEndpoint({});
    vi.stubGlobal("fetch", fetchMock);

    accountFindUnique.mockResolvedValue({
      accessTokenEncrypted: encryptSecret(ACCESS_TOKEN),
      refreshTokenEncrypted: encryptSecret(REFRESH_TOKEN),
      tokenExpiresAt: inMinutes(60),
    });

    await getGitHubClient("user_1");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a token that expires inside the skew window", async () => {
    const fetchMock = mockTokenEndpoint({
      access_token: NEW_ACCESS_TOKEN,
      refresh_token: NEW_REFRESH_TOKEN,
      expires_in: 28800,
      scope: "repo",
    });
    vi.stubGlobal("fetch", fetchMock);

    accountFindUnique.mockResolvedValue({
      accessTokenEncrypted: encryptSecret(ACCESS_TOKEN),
      refreshTokenEncrypted: encryptSecret(REFRESH_TOKEN),
      // Not yet expired, but inside the 5-minute safety margin.
      tokenExpiresAt: inMinutes(2),
    });

    await getGitHubClient("user_1");

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    ) as Record<string, string>;
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe(REFRESH_TOKEN);
  });

  it("persists the rotated access and refresh tokens, encrypted", async () => {
    vi.stubGlobal(
      "fetch",
      mockTokenEndpoint({
        access_token: NEW_ACCESS_TOKEN,
        refresh_token: NEW_REFRESH_TOKEN,
        expires_in: 28800,
      }),
    );

    accountFindUnique.mockResolvedValue({
      accessTokenEncrypted: encryptSecret(ACCESS_TOKEN),
      refreshTokenEncrypted: encryptSecret(REFRESH_TOKEN),
      tokenExpiresAt: inMinutes(-1),
    });

    await getGitHubClient("user_1");

    const call = accountUpdate.mock.calls[0]?.[0] as {
      where: { userId: string };
      data: {
        accessTokenEncrypted: string;
        refreshTokenEncrypted: string;
        tokenExpiresAt: Date | null;
      };
    };

    expect(call.where.userId).toBe("user_1");
    expect(decryptSecret(call.data.accessTokenEncrypted)).toBe(NEW_ACCESS_TOKEN);
    expect(decryptSecret(call.data.refreshTokenEncrypted)).toBe(NEW_REFRESH_TOKEN);
    expect(call.data.tokenExpiresAt).toBeInstanceOf(Date);

    // The ciphertext must not contain the plaintext token.
    expect(call.data.accessTokenEncrypted).not.toContain(NEW_ACCESS_TOKEN);
  });

  it("fails cleanly when the token expired and no refresh token was stored", async () => {
    vi.stubGlobal("fetch", mockTokenEndpoint({}));

    accountFindUnique.mockResolvedValue({
      accessTokenEncrypted: encryptSecret(ACCESS_TOKEN),
      refreshTokenEncrypted: null,
      tokenExpiresAt: inMinutes(-10),
    });

    await expect(getGitHubClient("user_1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("recovers when a concurrent run already rotated the token", async () => {
    // GitHub rejects a refresh token that another request just consumed.
    vi.stubGlobal("fetch", mockTokenEndpoint({ error: "bad_refresh_token" }));

    accountFindUnique
      .mockResolvedValueOnce({
        accessTokenEncrypted: encryptSecret(ACCESS_TOKEN),
        refreshTokenEncrypted: encryptSecret(REFRESH_TOKEN),
        tokenExpiresAt: inMinutes(-1),
      })
      // Re-read: the winning request has stored a fresh token.
      .mockResolvedValueOnce({
        accessTokenEncrypted: encryptSecret(NEW_ACCESS_TOKEN),
        tokenExpiresAt: inMinutes(480),
      });

    await expect(getGitHubClient("user_1")).resolves.toBeDefined();
    expect(accountUpdate).not.toHaveBeenCalled();
  });

  it("propagates the failure when the refresh genuinely failed", async () => {
    vi.stubGlobal("fetch", mockTokenEndpoint({ error: "bad_refresh_token" }));

    accountFindUnique
      .mockResolvedValueOnce({
        accessTokenEncrypted: encryptSecret(ACCESS_TOKEN),
        refreshTokenEncrypted: encryptSecret(REFRESH_TOKEN),
        tokenExpiresAt: inMinutes(-1),
      })
      // Still stale on re-read: nobody else refreshed it.
      .mockResolvedValueOnce({
        accessTokenEncrypted: encryptSecret(ACCESS_TOKEN),
        tokenExpiresAt: inMinutes(-1),
      });

    await expect(getGitHubClient("user_1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("reports a decryption failure as a renewable connection error", async () => {
    vi.stubGlobal("fetch", mockTokenEndpoint({}));

    accountFindUnique.mockResolvedValue({
      accessTokenEncrypted: "v1.bogus.bogus.bogus",
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
    });

    await expect(getGitHubClient("user_1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
