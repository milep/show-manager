import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/src/app";
import { makeDraft, makeRemoteStatus } from "./test-helpers";

describe("smoke", () => {
  it("serves status without extra config", async () => {
    const app = createApp({
      config: {} as never,
      paths: {} as never,
      store: {
        getDraftShow: async () => makeDraft(),
        getLastApplied: async () => null,
        getLibrary: async () => ({ items: [] }),
      } as never,
      mediaStore: {} as never,
      bundleService: {} as never,
      raspController: { status: async () => makeRemoteStatus() } as never,
      adbYoutubeController: { getPlaybackStatus: async () => ({ connected: true, state: "idle", packageName: null, videoId: null, title: null, subtitle: null, album: null, positionMs: null, durationMs: null, checkedAt: new Date().toISOString(), detail: null }) } as never,
      youtubeQueueScheduler: { status: () => ({ enabled: false, lastTickAt: null, lastError: null }), getCachedPlaybackStatus: () => null, tick: async () => undefined } as never,
      youtubeStore: {} as never,
      youtubeSearchService: {} as never,
      runtime: { applyInProgress: false },
    });

    const response = await request(app).get("/status");
    expect(response.status).toBe(200);
    expect(response.text).toBe("ok");
  });
});
