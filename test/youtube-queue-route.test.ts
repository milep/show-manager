import Database from "better-sqlite3";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/src/app";
import { ShowStateStore } from "../server/src/services/show-state-store";
import { YoutubeQueueScheduler } from "../server/src/services/youtube-queue-scheduler";
import type { AdbYoutubeController } from "../server/src/services/adb-youtube-controller";
import { PIPPALOT_PLAYLIST_ID, YoutubeStore } from "../server/src/services/youtube-store";
import { makeConfig, makeRemoteStatus, makeTempPaths } from "./test-helpers";
import { YoutubeTitleService } from "../server/src/services/youtube-title-service";

const fixtures: Array<{ root: string; store: YoutubeStore }> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
    await expect(access(fixture.root)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

function seedPippalot(dbFile: string, videoIds = ["GF3wagWwHjM", "Kdg4DLAPC4A", "NP0H491rRFU"]) {
  const db = new Database(dbFile);
  const now = new Date().toISOString();
  const insertMedia = db.prepare(`
    insert into youtube_media (id, source_id, url, kind, title, artist, album, channel, duration_ms, thumbnail_url, created_at, updated_at)
    values (?, ?, ?, 'video', ?, null, null, 'Pippalot', null, null, ?, ?)
  `);
  const insertPlaylistItem = db.prepare("insert into youtube_playlist_items (id, playlist_id, media_item_id, position, added_at) values (?, ?, ?, ?, ?)");
  const txn = db.transaction(() => {
    db.prepare("insert into youtube_playlists (id, name, created_at, updated_at) values (?, 'Pippalot', ?, ?)").run(PIPPALOT_PLAYLIST_ID, now, now);
    videoIds.forEach((videoId, index) => {
      const mediaId = `pippalot-media-${index}`;
      insertMedia.run(mediaId, videoId, `https://www.youtube.com/watch?v=${videoId}`, `Pippalot ${index + 1}`, now, now);
      insertPlaylistItem.run(`pippalot-item-${index}`, PIPPALOT_PLAYLIST_ID, mediaId, index + 1, now);
    });
  });
  txn();
  db.close();
}

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
}, publicSessionValid = true, titleFetch?: typeof fetch) {
  const paths = await makeTempPaths();
  const store = new ShowStateStore(paths);
  const youtubeStore = new YoutubeStore(paths);
  fixtures.push({ root: paths.root, store: youtubeStore });
  // These route fixtures count tick-triggered launches, using the real scheduler.
  let ticks = 0;
  const playbackActions: string[] = [];
  const controller = {
    getPlaybackStatus: async () => playback(),
    playVideo: async () => { ticks += 1; },
    togglePower: async () => { playbackActions.push("power"); },
    pause: async () => { playbackActions.push("pause"); },
    play: async () => { playbackActions.push("play"); },
  } as unknown as AdbYoutubeController;
  const scheduler = new YoutubeQueueScheduler(youtubeStore, controller);
  const titleService = new YoutubeTitleService(youtubeStore, titleFetch ?? (async () => { throw new Error("Synthetic metadata unavailable"); }), () => titleFetch ? "synthetic-route-key" : null);
  const app = createApp({
    config: makeConfig(paths.root),
    paths,
    store,
    mediaStore: {} as never,
    bundleService: {} as never,
    raspController: { status: async () => makeRemoteStatus() } as never,
    adbYoutubeController: controller,
    youtubeQueueScheduler: scheduler,
    youtubeStore,
    youtubeTitleService: titleService,
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
      isValidSession: async () => publicSessionValid,
    } as never,
    runtime: { applyInProgress: false },
  });
  return { app, store, youtubeStore, paths, getTicks: () => ticks, playbackActions, scheduler, controller, titleService };
}

describe("youtube queue route", () => {
  it("prepares URL/video additions and future catalog/Pippalot imports, never provider calls on reads/loads/ticks", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).includes("oembed")
      ? Response.json({ title: "Label - Artist - Song (OFFICIAL VIDEO)" })
      : Response.json({ choices: [{ message: { content: " Artist - Song " } }] }));
    const f = await makeApp(undefined, true, fetchMock);
    seedPippalot(f.paths.youtubeDbFile, []);
    const url = await request(f.app).post("/api/youtube-queue/items").send({ url: "https://youtu.be/GF3wagWwHjM" });
    expect(url.body.queue.items[0]).toMatchObject({ title: "Label - Artist - Song (OFFICIAL VIDEO)", displayTitle: "Artist - Song" });
    const video = await request(f.app).post("/api/youtube-queue/items/next").send({ videoId: "Kdg4DLAPC4A", kind: "video", title: "Label - Artist - Song (OFFICIAL VIDEO)", artists: ["Label"] });
    expect(video.status).toBe(201);
    expect(video.body.queue.items[1]).toMatchObject({ displayTitle: "Artist - Song", channel: "Label" });
    await request(f.app).post("/api/youtube/playlists/pippalot/items").send({ url: "https://youtu.be/NP0H491rRFU" });
    await request(f.app).post("/api/youtube/confirmed-videos/import").send({ items: [{ videoId: "Tb0MC0jFv6M", title: "Label - Artist - Song (OFFICIAL VIDEO)" }] });
    expect(f.youtubeStore.getVideoTitle("Tb0MC0jFv6M").displayTitle).toBe("Artist - Song");
    const beforeDuplicates = fetchMock.mock.calls.length;
    const repeated = await request(f.app).post("/api/youtube/confirmed-videos/import").send({ items: [
      { videoId: "Tb0MC0jFv6M", title: "Replacement" },
      { videoId: "aaaaaaaaaaa", title: "Raw new title" },
      { videoId: "aaaaaaaaaaa", title: "Duplicate payload" },
    ] });
    expect(repeated.body).toEqual({ imported: 1, skippedExisting: 2, invalid: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(beforeDuplicates + 2);
    const calls = fetchMock.mock.calls.length;
    await request(f.app).get("/api/youtube-queue");
    await request(f.app).get("/api/youtube/search?q=artist");
    await request(f.app).get("/api/youtube/playlists");
    await request(f.app).post("/api/youtube-queue/radio");
    await request(f.app).post("/api/youtube-queue/pippalot");
    await request(f.app).post("/api/youtube-queue/load-playlist").send({ playlistId: "pippalot" });
    await f.scheduler.tick();
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(f.youtubeStore.getQueue().items.every((item) => item.displayTitle === "Artist - Song")).toBe(true);
    expect(JSON.stringify(url.body)).not.toContain("synthetic-route-key");
  });

  it.each(["url", "video", "catalog"] as const)("%s reuse of an uncleaned structured song formats stored artist/name without provider calls", async (addition) => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("No external calls permitted"));
    const f = await makeApp(undefined, true, fetchMock);
    f.youtubeStore.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM", kind: "music", artist: "Artist feat. Guest", title: "Song (Live Remix)" });
    f.youtubeStore.setAutomationPaused(true);
    const before = f.youtubeStore.getQueue();
    const response = addition === "catalog"
      ? await request(f.app).post("/api/youtube/confirmed-videos/import").send({ items: [{ videoId: "GF3wagWwHjM", title: "Incoming catalog replacement" }] })
      : await request(f.app).post("/api/youtube-queue/items").send(addition === "url"
        ? { url: "https://youtu.be/GF3wagWwHjM" }
        : { videoId: "GF3wagWwHjM", kind: "video", title: "Incoming video replacement" });
    expect(response.status).toBe(201);
    const displayTitle = "Artist feat. Guest - Song (Live Remix)";
    expect(f.youtubeStore.getQueue().items[0]).toEqual({ ...before.items[0], displayTitle });
    expect(f.youtubeStore.getVideoTitle("GF3wagWwHjM")).toMatchObject({ title: "Song (Live Remix)", displayTitle, kind: "music", artist: "Artist feat. Guest", requiresArtistSong: true });
    if (addition === "catalog") {
      expect(response.body).toEqual({ imported: 1, skippedExisting: 0, invalid: 0 });
      const db = new Database(f.paths.youtubeDbFile);
      try {
        expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Incoming catalog replacement", display_title: displayTitle });
      } finally { db.close(); }
    } else {
      expect(response.body.queue.items[1]).toMatchObject({ title: "Song (Live Remix)", displayTitle, artist: "Artist feat. Guest" });
    }
    expect(f.youtubeStore.isAutomationPaused()).toBe(true);
    expect(f.getTicks()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("future confirmed import keeps its own fuller original and rejects bare music output despite an existing bare success", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      expect(String(url)).toContain("openrouter.ai");
      expect(JSON.parse(String(options?.body)).messages[1].content).toBe("Rammstein - Angst (Official Video)");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Angst" } }] });
    });
    const f = await makeApp(undefined, true, fetchMock);
    f.youtubeStore.addToQueue({ sourceId: "ONj9cvHCado", url: "https://youtu.be/ONj9cvHCado", title: "Angst", displayTitle: "Angst", kind: "video", channel: "Rammstein" });
    f.youtubeStore.setAutomationPaused(true);
    const before = f.youtubeStore.getQueue();
    const response = await request(f.app).post("/api/youtube/confirmed-videos/import").send({ items: [{ videoId: "ONj9cvHCado", title: "Rammstein - Angst (Official Video)" }] });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ imported: 1, skippedExisting: 0, invalid: 0 });
    expect(f.youtubeStore.getQueue()).toEqual(before);
    expect(f.youtubeStore.getVideoTitle("ONj9cvHCado")).toMatchObject({ title: "Angst", sourceTitle: "Rammstein - Angst (Official Video)", needsCleanup: true, incompleteDisplay: true });
    const db = new Database(f.paths.youtubeDbFile);
    try {
      expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Rammstein - Angst (Official Video)", display_title: null });
    } finally { db.close(); }
    await request(f.app).get("/api/youtube-queue");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(f.getTicks()).toBe(0);
    expect(f.youtubeStore.isAutomationPaused()).toBe(true);
  });

  it("metadata/provider waits do not block serialized pause or hold SQLite write locks", async () => {
    let release = () => {};
    let entered = () => {};
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      entered(); await waiting;
      return Response.json({ choices: [{ message: { content: "Artist - Song" } }] });
    });
    const f = await makeApp(undefined, true, fetchMock);
    const addition = request(f.app).post("/api/youtube-queue/items").send({ videoId: "GF3wagWwHjM", kind: "video", title: "Raw title" }).then((response) => response);
    await started;
    try {
      const pause = await request(f.app).post("/api/youtube-playback/pause");
      expect(pause.status).toBe(200);
      expect(f.playbackActions).toEqual(["pause"]);
      const db = new Database(f.paths.youtubeDbFile);
      try { db.prepare("insert into youtube_meta values ('synthetic-wait', 'unlocked')").run(); } finally { db.close(); }
    } finally { release(); }
    expect((await addition).status).toBe(201);
    expect(f.youtubeStore.isAutomationPaused()).toBe(true);
    expect(f.getTicks()).toBe(0);
  });
  it("edits only queue entries, preserves duplicates/settings, and persists adjacent swaps", async () => {
    const { app, youtubeStore, paths, getTicks } = await makeApp();
    seedPippalot(paths.youtubeDbFile);
    youtubeStore.importConfirmedVideos([{ videoId: "GF3wagWwHjM", title: "Cached video" }]);
    youtubeStore.loadPlaylistToQueue(PIPPALOT_PLAYLIST_ID);
    youtubeStore.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });
    const [playing, first, second, duplicate] = youtubeStore.getQueue().items;
    if (!playing || !first || !second || !duplicate) throw new Error("Expected seeded queue.");
    youtubeStore.markPlaying(playing.id);
    const before = youtubeStore.getQueue();
    const db = new Database(paths.youtubeDbFile);
    const sourceTables = ["youtube_media", "youtube_playlists", "youtube_playlist_items", "youtube_confirmed_videos"];
    const readSources = () => sourceTables.map((table) => db.prepare(`select * from ${table} order by id`).all());
    const sourcesBefore = readSources();
    const cachedFile = path.join(paths.root, "synthetic-cache.txt");
    await writeFile(cachedFile, "synthetic cached media");
    try {
      for (const [id, direction] of [[first.id, "up"], [duplicate.id, "down"]]) {
        const boundary = await request(app).post(`/api/youtube-queue/items/${id}/move`).send({ direction });
        expect(boundary.status).toBe(200);
        expect(boundary.body.queue).toEqual(before);
      }
      const up = await request(app).post(`/api/youtube-queue/items/${second.id}/move`).set("x-show-manager-access", "public").send({ direction: "up" });
      expect(up.status).toBe(200);
      expect(up.body.queue.items).toEqual([before.items[0], second, first, duplicate]);
      expect(up.body.queue.currentItemId).toBe(playing.id);
      const down = await request(app).post(`/api/youtube-queue/items/${second.id}/move`).send({ direction: "down" });
      expect(down.body.queue.items).toEqual(before.items);
      const removed = await request(app).delete(`/api/youtube-queue/items/${duplicate.id}`).set("x-show-manager-access", "public");
      expect(removed.status).toBe(200);
      expect(removed.body.queue.items).toEqual(before.items.slice(0, 3));
      expect(removed.body.queue.currentItemId).toBe(playing.id);
      expect(readSources()).toEqual(sourcesBefore);
      expect(await readFile(cachedFile, "utf8")).toBe("synthetic cached media");
      expect(getTicks()).toBe(0);
      const reopened = new YoutubeStore(paths);
      try {
        expect(reopened.getQueue()).toEqual(removed.body.queue);
      } finally {
        reopened.close();
      }
    } finally {
      db.close();
    }
  });

  it("ignores boundary, absent, playing and completed move targets", async () => {
    const { app, youtubeStore, getTicks } = await makeApp();
    const input = { sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" };
    youtubeStore.addToQueue(input);
    const completed = youtubeStore.firstPending();
    if (!completed) throw new Error("Expected item.");
    youtubeStore.markPlaying(completed.id);
    youtubeStore.completeCurrent();
    youtubeStore.addToQueue(input);
    const playing = youtubeStore.firstPending();
    if (!playing) throw new Error("Expected item.");
    youtubeStore.markPlaying(playing.id);
    youtubeStore.addToQueue(input);
    const single = youtubeStore.getQueue().items.find((item) => item.id !== playing.id);
    if (!single) throw new Error("Expected upcoming item.");
    const before = youtubeStore.getQueue();
    for (const id of [single.id, playing.id, completed.id, "missing"]) {
      for (const direction of ["up", "down"]) {
        const response = await request(app).post(`/api/youtube-queue/items/${id}/move`).send({ direction });
        expect(response.status).toBe(200);
        expect(response.body.queue).toEqual(before);
      }
    }
    const protectedRemove = await request(app).delete(`/api/youtube-queue/items/${playing.id}`);
    expect(protectedRemove.body.queue.items).toEqual(before.items);
    expect(getTicks()).toBe(0);
  });

  it("rejects invalid move directions without changing a valid queue", async () => {
    const { app, youtubeStore } = await makeApp();
    youtubeStore.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });
    youtubeStore.addToQueue({ sourceId: "Kdg4DLAPC4A", url: "https://www.youtube.com/watch?v=Kdg4DLAPC4A" });
    const before = youtubeStore.getQueue();
    for (const body of [{ direction: "sideways" }, { direction: 1 }, {}]) {
      const response = await request(app).post(`/api/youtube-queue/items/${before.items[0]?.id}/move`).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error).toContain("direction");
      expect(youtubeStore.getQueue()).toEqual(before);
    }
  });

  it("requires a QR session for public edits and does not expose source edits", async () => {
    const { app, youtubeStore } = await makeApp(undefined, false);
    youtubeStore.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });
    const before = youtubeStore.getQueue();
    const id = before.items[0]?.id;
    const move = await request(app).post(`/api/youtube-queue/items/${id}/move`).set("x-show-manager-access", "public").send({ direction: "down" });
    const remove = await request(app).delete(`/api/youtube-queue/items/${id}`).set("x-show-manager-access", "public");
    expect(move.status).toBe(401);
    expect(remove.status).toBe(401);
    expect(youtubeStore.getQueue()).toEqual(before);
    const authenticated = await makeApp();
    const sourceMove = await request(authenticated.app).post("/api/youtube/playlists/pippalot/items/id/move").set("x-show-manager-access", "public").send({ direction: "up" });
    const wrongMethod = await request(authenticated.app).put("/api/youtube-queue/items/id/move").set("x-show-manager-access", "public").send({ direction: "up" });
    expect(sourceMove.status).toBe(403);
    expect(wrongMethod.status).toBe(403);
  });

  it("removes the last upcoming entry and safely ignores moves in an empty queue", async () => {
    const { app, youtubeStore } = await makeApp();
    youtubeStore.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });
    const id = youtubeStore.getQueue().items[0]?.id;
    const removed = await request(app).delete(`/api/youtube-queue/items/${id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.queue.items).toEqual([]);
    const move = await request(app).post(`/api/youtube-queue/items/${id}/move`).send({ direction: "up" });
    expect(move.status).toBe(200);
    expect(move.body.queue.items).toEqual([]);
  });

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

  it("imports confirmed videos as trusted-only append-only data", async () => {
    const { app, youtubeStore } = await makeApp();
    const item = { videoId: "NP0H491rRFU", title: "IMMORTAL - Blashyrkh", channel: "Immortal", source: "playlist:test", confidence: "confirmed" };

    const publicResponse = await request(app).post("/api/youtube/confirmed-videos/import").set("x-show-manager-access", "public").send({ items: [item] });
    const firstImport = await request(app).post("/api/youtube/confirmed-videos/import").send({ items: [item] });
    const secondImport = await request(app).post("/api/youtube/confirmed-videos/import").send({ items: [item] });
    const invalidImport = await request(app).post("/api/youtube/confirmed-videos/import").send({ items: [{ videoId: "bad" }, item] });

    expect(publicResponse.status).toBe(403);
    expect(firstImport.status).toBe(201);
    expect(firstImport.body).toEqual({ imported: 1, skippedExisting: 0, invalid: 0 });
    expect(secondImport.body).toEqual({ imported: 0, skippedExisting: 1, invalid: 0 });
    expect(invalidImport.body).toEqual({ imported: 0, skippedExisting: 1, invalid: 1 });
    expect(youtubeStore.searchConfirmedVideos("immortal blashyrkh")[0]).toMatchObject({ videoId: "NP0H491rRFU", confirmed: true });
  });

  it("clears party queue as trusted-only action", async () => {
    const { app, youtubeStore, playbackActions } = await makeApp();
    youtubeStore.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });

    const publicResponse = await request(app).post("/api/youtube-queue/clear").set("x-show-manager-access", "public").send({});
    const trustedResponse = await request(app).post("/api/youtube-queue/clear").send({});

    expect(publicResponse.status).toBe(403);
    expect(trustedResponse.status).toBe(200);
    expect(trustedResponse.body.queue.items).toEqual([]);
    expect(playbackActions).toEqual(["pause"]);
  });

  it("replaces the queue from randomized cached Pippalot items", async () => {
    const { app, youtubeStore, paths, getTicks } = await makeApp();
    seedPippalot(paths.youtubeDbFile);
    youtubeStore.addToQueue({ sourceId: "Tb0MC0jFv6M", url: "https://www.youtube.com/watch?v=Tb0MC0jFv6M" });
    const orders = new Set<string>();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await request(app).post("/api/youtube-queue/pippalot").send({});
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ queued: 3 });
      const videoIds = youtubeStore.getQueue().items.map((item) => item.videoId);
      expect(new Set(videoIds)).toEqual(new Set(["GF3wagWwHjM", "Kdg4DLAPC4A", "NP0H491rRFU"]));
      orders.add(videoIds.join(","));
    }

    expect(orders.size).toBeGreaterThan(1);
    expect(getTicks()).toBe(12);
  });

  it("keeps Pippalot trusted-only", async () => {
    const { app, youtubeStore, paths } = await makeApp();
    seedPippalot(paths.youtubeDbFile);

    const response = await request(app).post("/api/youtube-queue/pippalot").set("x-show-manager-access", "public").send({});

    expect(response.status).toBe(403);
    expect(youtubeStore.getQueue().items).toEqual([]);
  });

  it("adds unique links to Pippalot without changing the party queue", async () => {
    const { app, youtubeStore, paths, getTicks } = await makeApp();
    seedPippalot(paths.youtubeDbFile);
    youtubeStore.addToQueue({ sourceId: "Tb0MC0jFv6M", url: "https://www.youtube.com/watch?v=Tb0MC0jFv6M" });

    const addedResponse = await request(app)
      .post("/api/youtube/playlists/pippalot/items")
      .send({ url: "https://youtu.be/Tb0MC0jFv6M?si=shared" });
    const duplicateResponse = await request(app)
      .post("/api/youtube/playlists/pippalot/items")
      .send({ url: "https://music.youtube.com/watch?v=Tb0MC0jFv6M" });

    const db = new Database(paths.youtubeDbFile);
    const rows = db.prepare(`
      select m.source_id, m.url
      from youtube_playlist_items i
      join youtube_media m on m.id = i.media_item_id
      where i.playlist_id = ? and m.source_id = ?
    `).all(PIPPALOT_PLAYLIST_ID, "Tb0MC0jFv6M") as Array<{ source_id: string; url: string }>;
    db.close();

    expect(addedResponse.status).toBe(201);
    expect(addedResponse.body).toEqual({ outcome: "added", videoId: "Tb0MC0jFv6M" });
    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body).toEqual({ outcome: "duplicate", videoId: "Tb0MC0jFv6M" });
    expect(rows).toEqual([{ source_id: "Tb0MC0jFv6M", url: "https://www.youtube.com/watch?v=Tb0MC0jFv6M" }]);
    expect(youtubeStore.getQueue().items.map((item) => item.videoId)).toEqual(["Tb0MC0jFv6M"]);
    expect(getTicks()).toBe(0);
  });

  it("validates trusted Pippalot additions", async () => {
    const { app, paths } = await makeApp();
    seedPippalot(paths.youtubeDbFile);

    const publicResponse = await request(app)
      .post("/api/youtube/playlists/pippalot/items")
      .set("x-show-manager-access", "public")
      .send({ url: "https://youtu.be/Tb0MC0jFv6M" });
    const invalidResponse = await request(app)
      .post("/api/youtube/playlists/pippalot/items")
      .send({ url: "https://example.com/watch?v=Tb0MC0jFv6M" });
    const uncached = await makeApp();
    const missingResponse = await request(uncached.app)
      .post("/api/youtube/playlists/pippalot/items")
      .send({ url: "https://youtu.be/Tb0MC0jFv6M" });

    expect(publicResponse.status).toBe(403);
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.error).toContain("YouTube link");
    expect(missingResponse.status).toBe(409);
    expect(missingResponse.body.error).toContain("not cached");
  });

  it("preserves the queue when Pippalot is not cached", async () => {
    const { app, youtubeStore, getTicks } = await makeApp();
    youtubeStore.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });

    const response = await request(app).post("/api/youtube-queue/pippalot").send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("not cached");
    expect(youtubeStore.getQueue().items.map((item) => item.videoId)).toEqual(["GF3wagWwHjM"]);
    expect(getTicks()).toBe(0);
  });

  it("loads confirmed videos as radio queue", async () => {
    const { app, youtubeStore, getTicks } = await makeApp();
    youtubeStore.importConfirmedVideos([
      { videoId: "NP0H491rRFU", title: "IMMORTAL - Blashyrkh", channel: "Immortal" },
      { videoId: "Kdg4DLAPC4A", title: "Septicflesh - Portrait", channel: "Season of Mist" },
    ]);

    const publicResponse = await request(app).post("/api/youtube-queue/radio").set("x-show-manager-access", "public").send({});
    const trustedResponse = await request(app).post("/api/youtube-queue/radio").send({});

    expect(publicResponse.status).toBe(403);
    expect(trustedResponse.status).toBe(200);
    expect(trustedResponse.body).toEqual({ queued: 2 });
    expect(youtubeStore.getQueue().items).toHaveLength(2);
    expect(getTicks()).toBe(1);
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

  it("keeps TV power control trusted-only", async () => {
    const { app, playbackActions } = await makeApp();

    const publicResponse = await request(app).post("/api/tv/power-toggle").set("x-show-manager-access", "public").send({});
    const trustedResponse = await request(app).post("/api/tv/power-toggle").send({});

    expect(publicResponse.status).toBe(403);
    expect(trustedResponse.status).toBe(200);
    expect(trustedResponse.body).toEqual({ ok: true });
    expect(playbackActions).toEqual(["power"]);
  });

  it("controls playback", async () => {
    const { app, playbackActions } = await makeApp();

    const playResponse = await request(app).post("/api/youtube-playback/play").send({});
    const pauseResponse = await request(app).post("/api/youtube-playback/pause").send({});

    expect(playResponse.status).toBe(200);
    expect(pauseResponse.status).toBe(200);
    expect(playbackActions).toEqual(["play", "pause"]);
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
