import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listMedia, MEDIA_PAGE_SIZE } from "@/lib/instagram/client";

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.INSTAGRAM_APP_ID = "app";
  process.env.INSTAGRAM_APP_SECRET = "secret";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.INSTAGRAM_APP_ID;
  delete process.env.INSTAGRAM_APP_SECRET;
});

const item = (id: string) => ({ id, media_type: "VIDEO", media_product_type: "REELS", thumbnail_url: `https://x.cdninstagram.com/${id}.jpg`, timestamp: "2026-10-01T00:00:00+0000" });

describe("instagram media pagination", () => {
  it("requests 10 items with only the fields the picker renders", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: [item("1")], paging: { cursors: { after: "QVFIUnext" }, next: "https://graph.instagram.com/next" } }),
    );
    const page = await listMedia("token");
    const url = new URL(fetchMock.mock.calls[0]![0] as URL);
    expect(MEDIA_PAGE_SIZE).toBe(10);
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("fields")).toBe("id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp");
    expect(url.searchParams.has("after")).toBe(false);
    expect(page).toMatchObject({ items: [{ id: "1", productType: "REELS" }], nextCursor: "QVFIUnext" });
  });

  it("passes the cursor through and ends when there is no next page", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: [item("11")], paging: { cursors: { after: "QVFIUlast" } } }));
    const page = await listMedia("token", { after: "QVFIUnext" });
    expect(new URL(fetchMock.mock.calls[0]![0] as URL).searchParams.get("after")).toBe("QVFIUnext");
    expect(page.nextCursor).toBeNull();
  });

  it("ignores a malformed cursor instead of forwarding it", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: [] }));
    await listMedia("token", { after: "abc&access_token=evil" });
    expect(new URL(fetchMock.mock.calls[0]![0] as URL).searchParams.has("after")).toBe(false);
  });

  it("maps an expired token to the typed revoked error", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 190, message: "expired", type: "OAuthException" } }, { status: 400 }));
    await expect(listMedia("token")).rejects.toMatchObject({ code: "INSTAGRAM_TOKEN_REVOKED" });
  });
});
