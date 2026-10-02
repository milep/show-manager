import { afterEach, describe, expect, it, vi } from "vitest";
import { moveYoutubeQueueItem, removeYoutubeQueueItem } from "../web/src/lib/api";

afterEach(() => { vi.unstubAllGlobals(); });

describe("queue editing API client", () => {
  it("sends entry IDs to queue-only endpoints and returns the persisted snapshot", async () => {
    const snapshot = { queue: { items: [], currentItemId: null, updatedAt: "2026-01-01T00:00:00.000Z" }, playback: {}, scheduler: {} };
    const fetch = vi.fn(async () => Response.json(snapshot));
    vi.stubGlobal("fetch", fetch);
    expect(await moveYoutubeQueueItem("entry/id", "up")).toEqual(snapshot);
    expect(await moveYoutubeQueueItem("entry/id", "down")).toEqual(snapshot);
    expect(await removeYoutubeQueueItem("entry/id")).toEqual(snapshot);
    expect(fetch.mock.calls).toEqual([
      ["/api/youtube-queue/items/entry%2Fid/move", { method: "POST", headers: { "content-type": "application/json" }, body: '{"direction":"up"}' }],
      ["/api/youtube-queue/items/entry%2Fid/move", { method: "POST", headers: { "content-type": "application/json" }, body: '{"direction":"down"}' }],
      ["/api/youtube-queue/items/entry%2Fid", { method: "DELETE" }],
    ]);
  });

  it("propagates server rejection and network failure instead of pretending an edit succeeded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "QR login required." }, { status: 401 })));
    await expect(moveYoutubeQueueItem("entry", "up")).rejects.toThrow("QR login required.");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network unavailable"); }));
    await expect(removeYoutubeQueueItem("entry")).rejects.toThrow("Network unavailable");
  });
});
