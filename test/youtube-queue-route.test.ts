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

async function makeApp(searchResponse = {
  results: [{ kind: "song", videoId: "GF3wagWwHjM", title: "teardrop", artists: ["Artist"], album: "Album", duration: "3:00", durationMs: 180000, thumbnails: [] }],
  warnings: [],
}) {
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
    youtubeSearchService: {
      suggestions: async (query: string) => ({ suggestions: [`${query} suggestion`] }),
      search: async (query: string) => ({
        ...searchResponse,
        results: searchResponse.results.map((result) => ({ ...result, title: query })),
      }),
    } as never,
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

  it("returns search suggestions for QR users", async () => {
    const { app } = await makeApp();

    const response = await request(app).get("/api/youtube/search-suggestions?q=tear").set("x-show-manager-access", "public");

    expect(response.status).toBe(200);
    expect(response.body.suggestions).toEqual(["tear suggestion"]);
  });

  it("rejects blank suggestion queries", async () => {
    const { app } = await makeApp();

    const response = await request(app).get("/api/youtube/search-suggestions?q=%20%20").set("x-show-manager-access", "public");

    expect(response.status).toBe(400);
  });

  it("searches for QR users", async () => {
    const { app } = await makeApp();

    const response = await request(app).get("/api/youtube/search?q=teardrop").set("x-show-manager-access", "public");

    expect(response.status).toBe(200);
    expect(response.body.results[0]).toMatchObject({ kind: "song", title: "teardrop" });
  });

  it("rejects blank search queries", async () => {
    const { app } = await makeApp();

    const response = await request(app).get("/api/youtube/search?q=%20%20").set("x-show-manager-access", "public");

    expect(response.status).toBe(400);
  });

  it("returns 502 when search dependencies fail", async () => {
    const { app } = await makeApp({ results: [], warnings: ["song search failed", "video search failed"] });

    const response = await request(app).get("/api/youtube/search?q=teardrop").set("x-show-manager-access", "public");

    expect(response.status).toBe(502);
    expect(response.body.warnings).toHaveLength(2);
  });

  it("adds search results by video id", async () => {
    const { app } = await makeApp();

    const response = await request(app)
      .post("/api/youtube-queue/items")
      .send({ videoId: "GF3wagWwHjM", kind: "song", title: "Teardrop", artists: ["Massive Attack"], album: "Mezzanine", durationMs: 330000 });

    expect(response.status).toBe(201);
    expect(response.body.queue.items[0]).toMatchObject({ videoId: "GF3wagWwHjM", title: "Teardrop", artist: "Massive Attack", album: "Mezzanine" });
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
