import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/src/app";
import { ShowStateStore } from "../server/src/services/show-state-store";
import { YoutubeStore } from "../server/src/services/youtube-store";
import { makeConfig, makeRemoteStatus, makeTempPaths } from "./test-helpers";

function playback() {
  return {
    connected: true,
    state: "idle" as const,
    packageName: null,
    videoId: null,
    title: null,
    subtitle: null,
    album: null,
    positionMs: null,
    durationMs: null,
    checkedAt: new Date().toISOString(),
    detail: null,
  };
}

async function makeApp() {
  const paths = await makeTempPaths();
  const store = new ShowStateStore(paths);
  const youtubeStore = new YoutubeStore(paths);
  let ticks = 0;
  const app = createApp({
    config: makeConfig(paths.root),
    paths,
    store,
    mediaStore: {} as never,
    bundleService: {} as never,
    raspController: { status: async () => makeRemoteStatus() } as never,
    adbYoutubeController: { getPlaybackStatus: async () => playback() } as never,
    youtubeQueueScheduler: {
      status: () => ({ enabled: false, lastTickAt: null, lastError: null }),
      getCachedPlaybackStatus: () => null,
      tick: async () => {
        ticks += 1;
      },
    } as never,
    youtubeStore,
    authService: {
      createSessionFromQrToken: async () => null,
      getQrStatus: async () => ({ active: false, publicUrl: null }),
      isValidSession: async () => true,
    } as never,
    runtime: { applyInProgress: false },
  });
  return { app, store, youtubeStore, getTicks: () => ticks };
}

describe("youtube queue route", () => {
  it("appends youtube links", async () => {
    const { app, getTicks } = await makeApp();

    const response = await request(app)
      .post("/api/youtube-queue/items")
      .send({ url: "https://youtu.be/GF3wagWwHjM?si=x" });

    expect(response.status).toBe(201);
    expect(response.body.queue.items).toHaveLength(1);
    expect(response.body.queue.items[0].videoId).toBe("GF3wagWwHjM");
    expect(getTicks()).toBe(1);
  });

  it("rejects invalid youtube links", async () => {
    const { app } = await makeApp();

    const response = await request(app).post("/api/youtube-queue/items").send({ url: "https://example.com" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("YouTube link");
  });

  it("returns queue snapshots", async () => {
    const { app } = await makeApp();

    const response = await request(app).get("/api/youtube-queue");

    expect(response.status).toBe(200);
    expect(response.body.queue.items).toEqual([]);
    expect(response.body.playback.state).toBe("idle");
  });

  it("keeps saved playlists trusted-only", async () => {
    const { app } = await makeApp();

    const publicResponse = await request(app).get("/api/youtube/playlists").set("x-show-manager-access", "public");
    const trustedResponse = await request(app).post("/api/youtube/playlists").send({ name: "Metal" });

    expect(publicResponse.status).toBe(403);
    expect(trustedResponse.status).toBe(201);
    expect(trustedResponse.body.playlist.name).toBe("Metal");
  });

  it("rejects invalid saved playlists", async () => {
    const { app } = await makeApp();

    const response = await request(app).post("/api/youtube/playlists").send({ name: "" });

    expect(response.status).toBe(400);
  });

  it("skips current item", async () => {
    const { app, youtubeStore } = await makeApp();
    youtubeStore.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });
    const pending = youtubeStore.firstPending();
    if (!pending) throw new Error("Expected pending item.");
    youtubeStore.markPlaying(pending.id);

    const response = await request(app).post("/api/youtube-queue/skip").send({});

    expect(response.status).toBe(200);
    expect(response.body.queue.currentItemId).toBeNull();
    expect(response.body.queue.items).toEqual([]);
  });
});
