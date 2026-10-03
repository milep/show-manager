import Database from "better-sqlite3";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadOpenRouterKey, OPENROUTER_TITLE_MODEL, TITLE_INSTRUCTION, YoutubeTitleService } from "../server/src/services/youtube-title-service";
import { YoutubeStore } from "../server/src/services/youtube-store";
import { cleanupYoutubeTitles } from "../server/src/services/youtube-title-cleanup";
import { youtubeQueueStateSchema } from "../shared/show-schema";
import { makeTempPaths } from "./test-helpers";

// Manual commands deliberately use the built server modules; test the current source, not stale dist.
beforeAll(async () => {
  await promisify(execFile)(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "server/tsconfig.json"]);
}, 30_000);

const fixtures: Array<{ root: string; store: YoutubeStore; db: Database.Database }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    f.db.close(); f.store.close(); await rm(f.root, { recursive: true, force: true });
    await expect(access(f.root)).rejects.toMatchObject({ code: "ENOENT" });
  }
});
async function fixture() {
  const paths = await makeTempPaths();
  const store = new YoutubeStore(paths);
  const db = new Database(paths.youtubeDbFile);
  fixtures.push({ root: paths.root, store, db });
  return { paths, store, db };
}
const videoId = "GF3wagWwHjM";
const input = { sourceId: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: "Label - Artist - Song (OFFICIAL VIDEO)", kind: "video" as const };
const completion = (title: string) => Response.json({ choices: [{ finish_reason: "stop", message: { content: title } }] });
const commandEvents = (stdout: string) => stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

// CLI fixture is a child-process native-fetch replacement; no sockets or credentials.
async function scriptFixture(root: string) {
  const hook = path.join(root, "mock-fetch.mjs");
  await writeFile(hook, `globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.includes('openrouter.ai')) {
      const body = JSON.parse(options.body);
      const title = body.messages[1].content;
      return Response.json({ choices: [{ message: { content: title === 'Guide to a Garden' ? title : 'Artist - Song (Live feat. Guest)' } }] });
    }
    if (address.includes('/oembed')) return Response.json({ title: 'Label - Artist - Song (Live feat. Guest) (OFFICIAL VIDEO)' });
    if (address.includes('/playlistItems')) return Response.json({ items: [{ contentDetails: { videoId: 'NP0H491rRFU' }, snippet: { title: 'Label - Artist - Song (OFFICIAL VIDEO)' } }] });
    if (address.includes('/videos')) return Response.json({ items: [{ id: '${videoId}', snippet: { title: 'Replacement raw title', channelTitle: 'New Channel', channelId: 'channel-id', thumbnails: { high: { url: 'https://example.invalid/thumb.jpg' } } } }] });
    throw new Error('Unexpected synthetic URL');
  };`);
  return (script: string, db: string, extra: string[] = []) => promisify(execFile)(process.execPath, ["--import", hook, `scripts/${script}`, "--db", db, ...extra], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: root, OPENROUTER_API_KEY: "synthetic-cli-key", YOUTUBE_DATA_API_KEY: "synthetic-youtube-key" },
  });
}

describe("YouTube title preparation", () => {
  it("fetches a bare URL source, trims successful cleanup and uses the exact prompt/model", async () => {
    const { store, db } = await fixture();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ title: input.title, author_name: "Label" })).mockResolvedValueOnce(completion("  Artist - Song  \n"));
    const service = new YoutubeTitleService(store, fetchMock, () => "synthetic-key");
    const prepared = await service.prepare({ sourceId: videoId, url: input.url });
    store.addToQueue(prepared);
    expect(store.getQueue().items[0]).toMatchObject({ title: input.title, displayTitle: "Artist - Song", channel: "Label" });
    youtubeQueueStateSchema.parse(store.getQueue());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/oembed?");
    const options = fetchMock.mock.calls[1]?.[1];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.headers).toMatchObject({ authorization: "Bearer synthetic-key" });
    expect(OPENROUTER_TITLE_MODEL).toBe("~z-ai/glm-flash-latest");
    expect(JSON.parse(String(options?.body))).toEqual({ model: "~z-ai/glm-flash-latest", temperature: 0.1, max_tokens: 160, reasoning: { enabled: false }, messages: [{ role: "system", content: TITLE_INSTRUCTION }, { role: "user", content: input.title }] });
    expect(JSON.stringify(store.getQueue())).not.toContain("synthetic-key");
    expect(db.prepare("select display_title from youtube_media").get()).toEqual({ display_title: "Artist - Song" });
  });

  it("disables reasoning without accepting a truncated Behemoth result or changing originals/budgets", async () => {
    const { store, db } = await fixture();
    const id = "SnTL1L8a6YI";
    const title = "Blow Your Trumpets Gabriel";
    const canonical = "BEHEMOTH - Blow Your Trumpets Gabriel (Official Music Video)CENSORED";
    store.addToQueue({ ...input, sourceId: id, url: `https://youtu.be/${id}`, title, channel: "Behemoth" });
    store.importConfirmedVideos([{ videoId: id, title: "Independent catalog original" }]);
    const before = store.getQueue();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ title: canonical, author_name: "Behemoth" }))
      .mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "length", message: { content: "BE" } }], usage: { completion_tokens: 160 } }))
      .mockResolvedValueOnce(Response.json({ title: canonical, author_name: "Behemoth" }))
      .mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "stop", message: { content: "BEHEMOTH - Blow Your Trumpets Gabriel" } }], usage: { completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 } } }));
    const service = new YoutubeTitleService(store, fetchMock, () => "synthetic-key");
    expect(await service.prepare({ sourceId: id, url: `https://youtu.be/${id}` })).toMatchObject({ title, displayTitle: null });
    expect(store.getQueue()).toEqual(before);
    expect(store.getVideoTitle(id).displayTitle).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await service.prepare({ sourceId: id, url: `https://youtu.be/${id}` })).toMatchObject({ title, displayTitle: "BEHEMOTH - Blow Your Trumpets Gabriel" });
    for (const index of [1, 3]) {
      expect(JSON.parse(String(fetchMock.mock.calls[index]?.[1]?.body))).toEqual({
        model: "~z-ai/glm-flash-latest", temperature: 0.1, max_tokens: 160, reasoning: { enabled: false },
        messages: [{ role: "system", content: TITLE_INSTRUCTION }, { role: "user", content: canonical }],
      });
    }
    expect(db.prepare("select title, display_title from youtube_media").get()).toEqual({ title, display_title: "BEHEMOTH - Blow Your Trumpets Gabriel" });
    expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Independent catalog original", display_title: "BEHEMOTH - Blow Your Trumpets Gabriel" });
    await service.prepare({ sourceId: id, url: `https://youtu.be/${id}` });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("formats structured songs directly and preserves qualifiers without provider calls", async () => {
    const { store } = await fixture();
    const fetchMock = vi.fn<typeof fetch>();
    const service = new YoutubeTitleService(store, fetchMock, () => "synthetic-key");
    store.addToQueue(await service.prepare({ ...input, kind: "music", artist: " Artist feat. Guest ", title: "Song (Live Remix)" }));
    expect(store.getQueue().items[0]).toMatchObject({ title: "Song (Live Remix)", displayTitle: "Artist feat. Guest - Song (Live Remix)" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["length", "content_filter", "error", "tool_calls", null])("rejects nonempty %s termination, allowing a later explicit preparation to succeed", async (finishReason) => {
    const { store, db } = await fixture();
    store.addToQueue(input);
    store.importConfirmedVideos([{ videoId, title: "Catalog original" }]);
    const before = store.getQueue();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: finishReason, message: { content: "Artist - Incomplete" } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "stop", message: { content: " Artist - Song (Live Remix) " } }] }));
    const service = new YoutubeTitleService(store, fetchMock, () => "synthetic-key");
    expect(await service.prepare(input)).toMatchObject({ title: input.title, displayTitle: null });
    expect(store.getQueue()).toEqual(before);
    expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Catalog original", display_title: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await service.prepare(input)).toMatchObject({ title: input.title, displayTitle: "Artist - Song (Live Remix)" });
    expect(store.getQueue()).toEqual({ ...before, items: before.items.map((item) => ({ ...item, displayTitle: "Artist - Song (Live Remix)" })) });
    expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Catalog original", display_title: "Artist - Song (Live Remix)" });
    await service.prepare(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["http", "network", "parse", "shape", "empty", "timeout", "absent-key"])("%s failure keeps addition usable with source fallback and no retries", async (failure) => {
    const { store } = await fixture();
    const warn = vi.spyOn(console, "warn");
    const log = vi.spyOn(console, "log");
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (failure === "network" || failure === "timeout") throw new Error("synthetic-key provider failure");
      if (failure === "http") return new Response("synthetic-key", { status: 503 });
      if (failure === "parse") return new Response("not JSON");
      if (failure === "shape") return Response.json({ choices: [{ message: { content: 123 } }] });
      return completion(" \n ");
    });
    store.addToQueue(await new YoutubeTitleService(store, fetchMock, () => failure === "absent-key" ? null : "synthetic-key").prepare(input));
    expect(store.getQueue().items[0]).toMatchObject({ title: input.title, displayTitle: null });
    expect(fetchMock).toHaveBeenCalledTimes(failure === "absent-key" ? 0 : 1);
    expect(warn).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
  });

  it("uses fixed bounded timeouts and falls back when the request is aborted", async () => {
    const { store } = await fixture();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true });
    }));
    const pending = new YoutubeTitleService(store, fetchMock, () => "synthetic-key").prepare(input);
    controller.abort();
    expect(await pending).toMatchObject({ title: input.title, displayTitle: null });
    expect(timeout).toHaveBeenCalledWith(10_000);
    const metadataController = new AbortController();
    timeout.mockReturnValue(metadataController.signal);
    const missing = new YoutubeTitleService(store, fetchMock, () => null).prepare({ sourceId: videoId, url: input.url });
    metadataController.abort();
    expect(await missing).toMatchObject({ title: null, displayTitle: null });
    expect(timeout).toHaveBeenCalledWith(8_000);
  });

  it("metadata HTTP/parse/network failures still permit title-less additions", async () => {
    const { store } = await fixture();
    for (const response of [new Response("", { status: 404 }), Response.json({ title: "" }), new Error("offline")]) {
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => { if (response instanceof Error) throw response; return response; });
      store.addToQueue(await new YoutubeTitleService(store, fetchMock, () => "synthetic-key").prepare({ sourceId: videoId, url: input.url }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    expect(store.getQueue().items.every((item) => item.title === null && item.displayTitle === null)).toBe(true);
  });

  it("loads only a synthetic optional server secret and prefers exported environment", async () => {
    const { paths } = await fixture();
    await mkdir(path.join(paths.root, ".config/secrets"), { recursive: true });
    const secret = path.join(paths.root, ".config/secrets/openrouter.env");
    expect(loadOpenRouterKey({ HOME: paths.root })).toBeNull();
    for (const line of ['OPENROUTER_API_KEY="file-key"', "export OPENROUTER_API_KEY='file-key'", "OPENROUTER_API_KEY=file-key # comment"]) {
      await writeFile(secret, line);
      expect(loadOpenRouterKey({ HOME: paths.root })).toBe("file-key");
    }
    expect(loadOpenRouterKey({ HOME: paths.root, OPENROUTER_API_KEY: " env-key " })).toBe("env-key");
    expect(loadOpenRouterKey({ HOME: paths.root, OPENROUTER_API_KEY: "" })).toBeNull();
    await writeFile(secret, 'OPENROUTER_API_KEY="unterminated');
    expect(loadOpenRouterKey({ HOME: paths.root })).toBeNull();
    await writeFile(secret, "UNRELATED_KEY=synthetic");
    expect(loadOpenRouterKey({ HOME: paths.root })).toBeNull();
  });
});

describe("stored music kind with full source and no structured artist", () => {
  const music = { ...input, kind: "music" as const, artist: null, title: "Artist - Song (Official Video)", channel: "Record Label" };

  it("normal cleanup selects and repairs a saved bare display without catalog while preserving original/state/timestamps", async () => {
    const { store, db } = await fixture();
    store.addToQueue({ ...music, displayTitle: "Song" });
    store.addToQueue(music);
    store.markPlaying(store.firstPending()!.id); store.setAutomationPaused(true);
    const playlist = store.createPlaylist("Saved music");
    db.prepare("insert into youtube_playlist_items values ('music-kind-reference', ?, ?, 7, '2026-01-01T00:00:00.000Z')").run(playlist.id, store.getQueue().items[0]!.mediaItemId);
    const identity = () => ["youtube_party_queue_items", "youtube_playlist_items", "youtube_playlists", "youtube_meta", "youtube_confirmed_videos"].map((table) => db.prepare(`select * from ${table}`).all());
    const beforeIdentity = identity();
    const beforeMedia = db.prepare("select * from youtube_media").get() as Record<string, unknown>;
    expect(store.getVideoTitle(videoId)).toMatchObject({ kind: "music", artist: null, confirmedSource: false, sourceTitle: music.title, requiresArtistSong: true, needsCleanup: true, incompleteDisplay: true });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      expect(String(url)).toContain("openrouter.ai");
      expect(JSON.parse(String(options?.body)).messages[1].content).toBe(music.title);
      expect(db.inTransaction).toBe(false);
      return completion("Artist - Song");
    });
    expect(await cleanupYoutubeTitles(db, { limit: 1 }, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 1, processed: 1, cleaned: 1, refreshed: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.prepare("select * from youtube_media").get()).toEqual({ ...beforeMedia, display_title: "Artist - Song" });
    expect(identity()).toEqual(beforeIdentity);
    expect(db.prepare("select count(*) as total from youtube_confirmed_videos").get()).toEqual({ total: 0 });
    expect(store.getVideoTitle(videoId)).toMatchObject({ title: music.title, needsCleanup: false, incompleteDisplay: false });
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["direct", "id-only"] as const)("%s preparation rejects bare completion for missing display, remains eligible, then accepts a full completion", async (entry) => {
    const { store, db } = await fixture();
    store.addToQueue(music); store.setAutomationPaused(true);
    const before = store.getQueue();
    const beforeMedia = db.prepare("select * from youtube_media").get() as Record<string, unknown>;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(completion("Song")).mockResolvedValueOnce(completion("Artist - Song"));
    const service = new YoutubeTitleService(store, fetchMock, () => "synthetic-key");
    if (entry === "direct") expect(await service.prepare(music)).toMatchObject({ kind: "music", title: music.title, displayTitle: null });
    else expect(await cleanupYoutubeTitles(db, { limit: 1 }, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 1, processed: 1, cleaned: 0, failed: 1 });
    expect(store.getQueue()).toEqual(before);
    expect(db.prepare("select * from youtube_media").get()).toEqual(beforeMedia);
    expect(store.getVideoTitle(videoId)).toMatchObject({ requiresArtistSong: true, needsCleanup: true, displayTitle: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (entry === "direct") expect(await service.prepare(music)).toMatchObject({ displayTitle: "Artist - Song" });
    else expect(await cleanupYoutubeTitles(db, { limit: 1 }, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 1, cleaned: 1, failed: 0 });
    expect(db.prepare("select * from youtube_media").get()).toEqual({ ...beforeMedia, display_title: "Artist - Song" });
    expect(store.getVideoTitle(videoId)).toMatchObject({ title: music.title, needsCleanup: false });
    expect(store.isAutomationPaused()).toBe(true);
    expect(db.prepare("select count(*) as total from youtube_confirmed_videos").get()).toEqual({ total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(String(url)).toContain("openrouter.ai");
      expect(JSON.parse(String(options?.body))).toEqual({ model: OPENROUTER_TITLE_MODEL, temperature: 0.1, max_tokens: 160, reasoning: { enabled: false }, messages: [{ role: "system", content: TITLE_INSTRUCTION }, { role: "user", content: music.title }] });
    }
  });

  it("video-shaped preparation retains stored music kind through canonical enrichment and re-addition", async () => {
    const { store } = await fixture();
    store.addToQueue({ ...music, title: "Song" });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ title: music.title, author_name: "Label" })).mockResolvedValueOnce(completion("Song"));
    const prepared = await new YoutubeTitleService(store, fetchMock, () => "synthetic-key").prepare({ sourceId: videoId, url: input.url, kind: "video" });
    expect(prepared).toMatchObject({ kind: "music", title: "Song", displayTitle: null });
    store.addToQueue(prepared);
    expect(store.getVideoTitle(videoId)).toMatchObject({ kind: "music", title: "Song", artist: null, displayTitle: null, needsCleanup: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("storage rejects incomplete writes and repairs only incomplete displays using stored music/full source context", async () => {
    const { store, db } = await fixture();
    store.addToQueue(music);
    const before = db.prepare("select * from youtube_media").get() as Record<string, unknown>;
    store.saveVideoTitle(videoId, { title: "Not the original", displayTitle: "Song" });
    expect(db.prepare("select * from youtube_media").get()).toEqual(before);
    store.saveVideoTitle(videoId, { title: "Not the original", displayTitle: "Artist - Song" });
    expect(db.prepare("select * from youtube_media").get()).toEqual({ ...before, display_title: "Artist - Song" });
    store.saveVideoTitle(videoId, { title: "Not the original", displayTitle: "Song" }, { replaceDisplay: true });
    expect(db.prepare("select * from youtube_media").get()).toEqual({ ...before, display_title: "Artist - Song" });
    store.saveVideoTitle(videoId, { title: "Not the original", displayTitle: "Artist - Other" });
    expect(db.prepare("select * from youtube_media").get()).toEqual({ ...before, display_title: "Artist - Song" });
  });

  it("reuses a complete sibling display for stored music without changing either original or the complete sibling", async () => {
    const { store, db } = await fixture();
    store.addToQueue({ ...music, displayTitle: "Song" });
    store.importConfirmedVideos([{ videoId, title: "Independent catalog original" }]);
    db.prepare("update youtube_confirmed_videos set display_title = 'Artist - Song (Live)' where video_id = ?").run(videoId);
    const beforeMedia = db.prepare("select * from youtube_media").get() as Record<string, unknown>;
    const beforeCatalog = db.prepare("select * from youtube_confirmed_videos").get();
    expect(store.getVideoTitle(videoId)).toMatchObject({ displayTitle: "Artist - Song (Live)", requiresArtistSong: true, needsCleanup: true });
    const fetchMock = vi.fn<typeof fetch>();
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 1, cleaned: 1, refreshed: 1 });
    expect(db.prepare("select * from youtube_media").get()).toEqual({ ...beforeMedia, display_title: "Artist - Song (Live)" });
    expect(db.prepare("select * from youtube_confirmed_videos").get()).toEqual(beforeCatalog);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves a concurrently saved complete display for no-catalog music with a bare saved display", async () => {
    const { store, db } = await fixture();
    store.addToQueue({ ...music, displayTitle: "Song" });
    const before = db.prepare("select * from youtube_media").get() as Record<string, unknown>;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      store.saveVideoTitle(videoId, { title: "Not the original", displayTitle: "Artist - Song (Live)" });
      return completion("Artist - Song");
    });
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 1, cleaned: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.prepare("select * from youtube_media").get()).toEqual({ ...before, display_title: "Artist - Song (Live)" });
  });

  it("nonmusic with the same full separator source and bare success still skips without channel inference", async () => {
    const { store, db } = await fixture();
    store.addToQueue({ ...music, kind: "video", displayTitle: "Song", channel: "Artist" });
    const before = store.getQueue();
    expect(store.getVideoTitle(videoId)).toMatchObject({ kind: "video", artist: null, requiresArtistSong: false, needsCleanup: false });
    const fetchMock = vi.fn<typeof fetch>();
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 0 });
    expect(await new YoutubeTitleService(store, fetchMock, () => "synthetic-key").prepare({ sourceId: videoId, url: input.url })).toMatchObject({ title: music.title, displayTitle: "Song" });
    expect(store.getQueue()).toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("all same-video artist context and known incomplete displays", () => {
  const songs = [
    { id: "ONj9cvHCado", title: "Angst", full: "Rammstein - Angst (Official Video)", display: "Rammstein - Angst", saved: false },
    { id: "-l-OiglL460", title: "Scars Of The Crucifix", full: "Deicide - Scars Of The Crucifix", display: "Deicide - Scars Of The Crucifix", saved: false },
    { id: "eF5iMLldBzE", title: "Pride in Prejudice", full: "SLAYER - Pride In Prejudice (OFFICIAL MUSIC VIDEO)", display: "SLAYER - Pride In Prejudice", saved: false },
    { id: "2YqZuo1WKk4", title: "Trial By Fire", full: "Judas Priest - Trial By Fire (Official Video)", display: "Judas Priest - Trial By Fire", saved: true },
    { id: "83_ekgZ13AY", title: "NSL", full: "Till Lindemann - NSL (Official Video)", display: "Till Lindemann - NSL", saved: true },
    { id: "0R-0ey4kchc", title: "Warriors", full: "ABBATH - Warriors (Live)", display: "ABBATH - Warriors (Live)", saved: true },
    { id: "3f20L0msLsM", title: "Detox", full: "STRAPPING YOUNG LAD - Detox (OFFICIAL VIDEO)", display: "STRAPPING YOUNG LAD - Detox", saved: true },
    { id: "092uOnSTnyI", title: "Ov My Herculean Exile", full: "BEHEMOTH - Ov My Herculean Exile (Official Music Video)", display: "BEHEMOTH - Ov My Herculean Exile", saved: true },
    { id: "FzjUayLrt10", title: "End Of The Line", full: "PAIN - End Of The Line (OFFICIAL MUSIC VIDEO)", display: "PAIN - End Of The Line", saved: true },
    { id: "JCN8qkWVu1w", title: "Let the Devil In", full: "DARK FUNERAL - Let the Devil In (OFFICIAL VIDEO)", display: "DARK FUNERAL - Let the Devil In", saved: true },
    { id: "-TZ6ec7M6_U", title: "Göttin", full: "CENTHRON - Göttin (Offiicial Music Video)", display: "CENTHRON - Göttin", saved: true },
  ];
  it.each(songs)("normal bounded cleanup uses fuller catalog context for $title without oEmbed", async (song) => {
    const { store, db } = await fixture();
    store.addToQueue({ ...input, sourceId: song.id, url: `https://youtu.be/${song.id}`, title: song.title, channel: "Record Label", displayTitle: song.saved ? song.title : null });
    store.importConfirmedVideos([{ videoId: song.id, title: song.full }]);
    store.markPlaying(store.firstPending()!.id); store.setAutomationPaused(true);
    const identity = db.prepare("select * from youtube_party_queue_items").all();
    const timestamps = db.prepare("select id, title, created_at, updated_at from youtube_media").all();
    expect(store.getVideoTitle(song.id)).toMatchObject({ title: song.title, sourceTitle: song.full, requiresArtistSong: true, needsCleanup: true, incompleteDisplay: song.saved });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      expect(String(url)).toContain("openrouter.ai");
      expect(db.inTransaction).toBe(false);
      expect(JSON.parse(String(options?.body)).messages[1].content).toBe(song.full);
      return completion(song.display);
    });
    const result = await cleanupYoutubeTitles(db, { limit: 1 }, fetchMock, () => "synthetic-key");
    expect(result).toMatchObject({ selected: 1, processed: 1, cleaned: 1, refreshed: song.saved ? 1 : 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.prepare("select title, display_title from youtube_media").get()).toEqual({ title: song.title, display_title: song.display });
    expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: song.full, display_title: song.display });
    expect(db.prepare("select * from youtube_party_queue_items").all()).toEqual(identity);
    expect(db.prepare("select id, title, created_at, updated_at from youtube_media").all()).toEqual(timestamps);
    expect(store.isAutomationPaused()).toBe(true);
    fetchMock.mockClear();
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses a complete sibling display and repairs only incomplete copies without provider calls", async () => {
    const { store, db } = await fixture();
    store.addToQueue({ ...input, title: "Song", displayTitle: "Song" });
    store.importConfirmedVideos([{ videoId, title: "Artist - Song (Live)" }]);
    db.prepare("update youtube_confirmed_videos set display_title = 'Artist - Song (Live)' where video_id = ?").run(videoId);
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("No lookup/provider allowed"));
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 1, cleaned: 1, refreshed: 1 });
    expect(store.getQueue().items[0]).toMatchObject({ title: "Song", displayTitle: "Artist - Song (Live)" });
    expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Artist - Song (Live)", display_title: "Artist - Song (Live)" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not discard real artist/name metadata when a legacy media kind says video", async () => {
    const { store, db } = await fixture();
    store.addToQueue({ ...input, title: "Artist - Song (Live)", artist: "Artist", displayTitle: "Song" });
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("No network allowed"));
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 1, cleaned: 1 });
    expect(store.getVideoTitle(videoId)).toMatchObject({ title: "Artist - Song (Live)", displayTitle: "Artist - Song (Live)" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["Song", "Artist - ", " - Song"])("rejects incomplete music output %j with available artist context, retaining rerun eligibility", async (badDisplay) => {
    const { store, db } = await fixture();
    store.addToQueue({ ...input, title: "Song", displayTitle: "Song" });
    store.importConfirmedVideos([{ videoId, title: "Artist - Song (Official Video)" }]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(completion(badDisplay)).mockResolvedValueOnce(completion("Artist - Song"));
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 1, processed: 1, failed: 1, cleaned: 0 });
    expect(store.getVideoTitle(videoId)).toMatchObject({ title: "Song", displayTitle: "Song", needsCleanup: true });
    expect(db.prepare("select title from youtube_confirmed_videos").get()).toEqual({ title: "Artist - Song (Official Video)" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 1, cleaned: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["http", "network", "parse", "empty", "length", "absent-key"])("%s failure with full stored catalog context remains usable and does not trigger oEmbed/retries", async (failure) => {
    const { store, db } = await fixture();
    store.addToQueue({ ...input, title: "Angst", displayTitle: "Angst" });
    store.importConfirmedVideos([{ videoId, title: "Rammstein - Angst (Official Video)" }]);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      expect(String(url)).toContain("openrouter.ai");
      if (failure === "network") throw new Error("synthetic secret failure");
      if (failure === "http") return new Response("synthetic secret", { status: 503 });
      if (failure === "parse") return new Response("invalid JSON");
      if (failure === "length") return Response.json({ choices: [{ finish_reason: "length", message: { content: "Rammstein - Angst" } }] });
      return completion(" ");
    });
    const result = await cleanupYoutubeTitles(db, {}, fetchMock, () => failure === "absent-key" ? null : "synthetic-key");
    expect(result).toMatchObject({ selected: 1, failed: 1, cleaned: 0 });
    expect(store.getVideoTitle(videoId)).toMatchObject({ title: "Angst", displayTitle: "Angst", needsCleanup: true });
    expect(fetchMock).toHaveBeenCalledTimes(failure === "absent-key" ? 0 : 1);
  });

  it("keeps unrelated nonmusic successes, including separator titles, out of normal cleanup", async () => {
    const { store, db } = await fixture();
    store.addToQueue({ ...input, title: "Guide to a Garden", displayTitle: "Guide to a Garden", channel: "Rammstein" });
    store.addToQueue({ sourceId: "NP0H491rRFU", url: "https://youtu.be/NP0H491rRFU", title: "News - Live report", displayTitle: "Live report", channel: "Label" });
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("No nonmusic reprocessing"));
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the explicitly known Residue item via canonical metadata without treating its channel as an artist", async () => {
    const { store, db } = await fixture();
    const id = "2fALV3X9jB4";
    store.addToQueue({ sourceId: id, url: `https://youtu.be/${id}`, title: "Residue", displayTitle: "Residue", channel: "KerryKing", kind: "video" });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ title: "KERRY KING - Residue (Official Music Video)", author_name: "Record Label" }))
      .mockResolvedValueOnce(completion("KERRY KING - Residue"));
    expect(await cleanupYoutubeTitles(db, { limit: 1, refreshVideoIds: [id] }, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 1, cleaned: 1, refreshed: 1 });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).messages[1].content).toBe("KERRY KING - Residue (Official Music Video)");
    expect(store.getVideoTitle(id)).toMatchObject({ title: "Residue", displayTitle: "KERRY KING - Residue" });
    expect(db.prepare("select count(*) as total from youtube_confirmed_videos").get()).toEqual({ total: 0 });
  });

  it("preserves a concurrently saved complete display while repairing incomplete catalog copies", async () => {
    const { store, db } = await fixture();
    store.addToQueue({ ...input, title: "Song", displayTitle: "Song" });
    store.importConfirmedVideos([{ videoId, title: "Artist - Song (Official Video)" }]);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      db.prepare("update youtube_media set display_title = 'Artist - Song (Live)' where source_id = ?").run(videoId);
      return completion("Artist - Song");
    });
    await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key");
    expect(db.prepare("select title, display_title from youtube_media").get()).toEqual({ title: "Song", display_title: "Artist - Song (Live)" });
    expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Artist - Song (Official Video)", display_title: "Artist - Song" });
  });

  it("actual normal CLI repairs known bare saved music across bounded batches using catalog context", async () => {
    const { store, db, paths } = await fixture();
    for (const song of [songs[0]!, songs[3]!]) {
      store.addToQueue({ ...input, sourceId: song.id, url: `https://youtu.be/${song.id}`, title: song.title, displayTitle: song.saved ? song.title : null });
      store.importConfirmedVideos([{ videoId: song.id, title: song.full }]);
    }
    store.markPlaying(store.firstPending()!.id); store.setAutomationPaused(true);
    const before = db.prepare("select * from youtube_party_queue_items").all();
    const hook = path.join(paths.root, "stored-context-fetch.mjs");
    await writeFile(hook, `globalThis.fetch = async (url, options) => {
      if (!String(url).includes('openrouter.ai')) throw new Error('Unexpected lookup');
      const title = JSON.parse(options.body).messages[1].content;
      const display = title === 'Rammstein - Angst (Official Video)' ? 'Rammstein - Angst' : title === 'Judas Priest - Trial By Fire (Official Video)' ? 'Judas Priest - Trial By Fire' : null;
      if (!display) throw new Error('Wrong source context');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: display } }] });
    };`);
    const run = () => promisify(execFile)(process.execPath, ["--import", hook, "scripts/youtube-cleanup-titles.mjs", "--db", paths.youtubeDbFile, "--limit", "1"], { env: { PATH: process.env.PATH, HOME: paths.root, OPENROUTER_API_KEY: "synthetic-context-key" } });
    const first = await run(); const second = await run(); const third = await run();
    expect(commandEvents(first.stdout).at(-1)).toMatchObject({ selected: 1, cleaned: 1, refreshed: 0 });
    expect(commandEvents(second.stdout).at(-1)).toMatchObject({ selected: 1, cleaned: 1, refreshed: 1 });
    expect(commandEvents(third.stdout).at(-1)).toMatchObject({ selected: 0 });
    expect(first.stdout + second.stdout + third.stdout).not.toMatch(/synthetic-context-key|Angst|Judas Priest/);
    expect(db.prepare("select * from youtube_party_queue_items").all()).toEqual(before);
    expect(store.isAutomationPaused()).toBe(true);
  });
});

describe("legacy title context and explicit refresh", () => {
  const legacy = [
    { id: "Ifi4DtLLKpM", title: "Bite Me!", channel: "Hocico", canonical: "Hocico - Bite me! (Official Music Video).", author: "Hocico", display: "Hocico - Bite me!", refresh: true },
    { id: "G_U74eyB5o8", title: "Need Some1", channel: "The Prodigy", canonical: "The Prodigy - Need Some1 (Official Video)", author: "TheProdigyVEVO", display: "The Prodigy - Need Some1", refresh: false },
    { id: "GF3wagWwHjM", title: "The Chosen Legacy", channel: "Nuclear Blast Records", canonical: "DIMMU BORGIR - The Chosen Legacy (OFFICIAL MUSIC VIDEO)", author: "Nuclear Blast Records", display: "DIMMU BORGIR - The Chosen Legacy", refresh: false },
    { id: "KbpFFUAegTw", title: "In Fire Reborn", channel: "The Haunted", canonical: "THE HAUNTED - In Fire Reborn (OFFICIAL VIDEO)", author: "Century Media Records", display: "THE HAUNTED - In Fire Reborn", refresh: false },
  ];
  it.each(legacy)("uses canonical artist context for $title but preserves its captured baseline", async (song) => {
    const { store, db } = await fixture();
    store.addToQueue({ sourceId: song.id, url: `https://youtu.be/${song.id}`, kind: "video", title: song.title, channel: song.channel, displayTitle: song.refresh ? song.title : null });
    store.importConfirmedVideos([{ videoId: song.id, title: "Independent catalog original" }]);
    const timestamps = db.prepare("select id, created_at, updated_at from youtube_media").all();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ title: song.canonical, author_name: song.author })).mockResolvedValueOnce(completion(song.display));
    const service = new YoutubeTitleService(store, fetchMock, () => "synthetic-key");
    const result = await service.prepare({ sourceId: song.id, url: `https://youtu.be/${song.id}` }, { refreshDisplay: song.refresh });
    expect(result).toMatchObject({ title: song.title, displayTitle: song.display });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).messages[1].content).toBe(song.canonical);
    expect(db.prepare("select title, display_title from youtube_media").get()).toEqual({ title: song.title, display_title: song.display });
    expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Independent catalog original", display_title: song.display });
    expect(db.prepare("select id, created_at, updated_at from youtube_media").all()).toEqual(timestamps);
    fetchMock.mockClear();
    await service.prepare({ sourceId: song.id, url: `https://youtu.be/${song.id}` });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["http", "parse", "network"])("%s canonical lookup failure preserves the old display and avoids blind artist inference", async (failure) => {
    const { store } = await fixture();
    store.addToQueue({ ...input, title: "Bite Me!", displayTitle: "Bite Me!", channel: "Record Label" });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (failure === "network") throw new Error("synthetic provider secret");
      return failure === "http" ? new Response("synthetic provider secret", { status: 404 }) : Response.json({ title: 123 });
    });
    const key = vi.fn(() => "synthetic-key");
    expect(await new YoutubeTitleService(store, fetchMock, key).prepare({ sourceId: videoId, url: input.url }, { refreshDisplay: true })).toMatchObject({ title: "Bite Me!", displayTitle: null });
    expect(store.getVideoTitle(videoId).displayTitle).toBe("Bite Me!");
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(key).not.toHaveBeenCalled();
  });

  it("failed legacy context lookup keeps normal cleanup and re-addition usable without guessing an artist", async () => {
    const { store, db } = await fixture();
    store.addToQueue({ ...input, title: "The Chosen Legacy", channel: "Nuclear Blast Records" });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response("", { status: 404 }));
    const summary = await cleanupYoutubeTitles(db, { limit: 1 }, fetchMock, () => "synthetic-key");
    expect(summary).toMatchObject({ selected: 1, processed: 1, failed: 1, cleaned: 0 });
    const prepared = await new YoutubeTitleService(store, fetchMock, () => "synthetic-key").prepare({ sourceId: videoId, url: input.url });
    store.addToQueue(prepared);
    expect(store.getQueue().items.every((item) => item.title === "The Chosen Legacy" && item.displayTitle === null)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) => String(call[0]).includes("/oembed"))).toBe(true);
  });

  it("keeps targeted poor displays on failed/truncated completion and formats structured refresh locally", async () => {
    const { store } = await fixture();
    store.addToQueue({ ...input, title: "Bite Me!", displayTitle: "Bite Me!" });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ title: "Hocico - Bite me! (Official Music Video)." }))
      .mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "length", message: { content: "Hocico - Bite" } }] }));
    const result = await new YoutubeTitleService(store, fetchMock, () => "synthetic-key").prepare(input, { refreshDisplay: true });
    expect(result.displayTitle).toBeNull();
    expect(store.getVideoTitle(videoId)).toMatchObject({ title: "Bite Me!", displayTitle: "Bite Me!" });
    store.addToQueue({ sourceId: "NP0H491rRFU", url: "https://youtu.be/NP0H491rRFU", kind: "music", title: "Song", artist: "Artist", displayTitle: "Song" });
    fetchMock.mockClear();
    const local = await new YoutubeTitleService(store, fetchMock, () => "synthetic-key").prepare({ sourceId: "NP0H491rRFU", url: "https://youtu.be/NP0H491rRFU" }, { refreshDisplay: true });
    expect(local).toMatchObject({ title: "Song", displayTitle: "Artist - Song" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("bounded manual title batches", () => {
  it("prioritizes current/upcoming unique IDs, respects the bound and preserves queue/playlist/pause identity", async () => {
    const { store, db } = await fixture();
    for (const id of ["aaaaaaaaaaa", "bbbbbbbbbbb", "yyyyyyyyyyy", "zzzzzzzzzzz"]) store.importConfirmedVideos([{ videoId: id, title: `Artist - ${id}` }]);
    store.addToQueue({ sourceId: "zzzzzzzzzzz", url: "https://youtu.be/zzzzzzzzzzz" });
    store.markPlaying(store.firstPending()!.id);
    store.addToQueue({ sourceId: "yyyyyyyyyyy", url: "https://youtu.be/yyyyyyyyyyy" });
    store.addToQueue({ sourceId: "yyyyyyyyyyy", url: "https://youtu.be/yyyyyyyyyyy" });
    store.setAutomationPaused(true);
    const playlist = store.createPlaylist("Saved");
    db.prepare("insert into youtube_playlist_items values ('saved-reference', ?, ?, 7, '2026-01-01T00:00:00.000Z')").run(playlist.id, store.firstPending()!.mediaItemId);
    const identity = () => ["youtube_party_queue_items", "youtube_playlist_items", "youtube_playlists", "youtube_meta"].map((table) => db.prepare(`select * from ${table}`).all());
    const before = identity();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      expect(db.inTransaction).toBe(false);
      return completion(JSON.parse(String(options?.body)).messages[1].content);
    });
    const progress: number[] = [];
    const summary = await cleanupYoutubeTitles(db, { limit: 2, onProgress: (value) => progress.push(value.processed) }, fetchMock, () => "synthetic-key");
    expect(summary).toMatchObject({ selected: 2, processed: 2, cleaned: 2, failed: 0, interrupted: false });
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).messages[1].content)).toEqual(["Artist - zzzzzzzzzzz", "Artist - yyyyyyyyyyy"]);
    expect(progress).toEqual([0, 1, 2]);
    expect(identity()).toEqual(before);
    fetchMock.mockClear();
    await cleanupYoutubeTitles(db, { limit: 1 }, fetchMock, () => "synthetic-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).messages[1].content).toBe("Artist - aaaaaaaaaaa");
    expect(identity()).toEqual(before);
  });

  it("targets only requested successful displays and normal reruns skip unchanged nonmusic", async () => {
    const { store, db } = await fixture();
    store.addToQueue({ ...input, title: "Bite Me!", displayTitle: "Bite Me!" });
    store.importConfirmedVideos([{ videoId, title: "Catalog original" }, { videoId: "NP0H491rRFU", title: "Guide to a Garden", displayTitle: "Guide to a Garden" }]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ title: "Hocico - Bite me! (Official Music Video)." })).mockResolvedValueOnce(completion("Hocico - Bite me!"));
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 0, processed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    const summary = await cleanupYoutubeTitles(db, { limit: 1, refreshVideoIds: [videoId] }, fetchMock, () => "synthetic-key");
    expect(summary).toMatchObject({ selected: 1, processed: 1, cleaned: 1, refreshed: 1 });
    expect(store.getVideoTitle(videoId)).toMatchObject({ title: "Bite Me!", displayTitle: "Hocico - Bite me!" });
    expect(db.prepare("select title, display_title from youtube_confirmed_videos where video_id = 'NP0H491rRFU'").get()).toEqual({ title: "Guide to a Garden", display_title: "Guide to a Garden" });
    fetchMock.mockClear();
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains partial commits on interrupt and reruns select only the remaining IDs", async () => {
    const { store, db } = await fixture();
    for (const id of ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]) store.importConfirmedVideos([{ videoId: id, title: `Artist - ${id}` }]);
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => completion("Artist - Song"));
    const summary = await cleanupYoutubeTitles(db, { signal: controller.signal, onProgress: (value) => { if (value.processed === 1) controller.abort(); } }, fetchMock, () => "synthetic-key");
    expect(summary).toMatchObject({ selected: 3, processed: 1, cleaned: 1, interrupted: true });
    expect(store.getVideoTitle("aaaaaaaaaaa").displayTitle).toBe("Artist - Song");
    expect(store.getVideoTitle("bbbbbbbbbbb").displayTitle).toBeNull();
    fetchMock.mockClear();
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toMatchObject({ selected: 2, processed: 2, cleaned: 2, interrupted: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("actual CLI defaults to 25, emits useful counter-only progress, bounds overrides and supports targeted refresh", async () => {
    const { store, paths } = await fixture();
    for (let index = 0; index < 28; index += 1) store.importConfirmedVideos([{ videoId: String(index).padStart(11, "0"), title: `Artist - Song ${index}` }]);
    const run = await scriptFixture(paths.root);
    const first = await run("youtube-cleanup-titles.mjs", paths.youtubeDbFile);
    const events = commandEvents(first.stdout);
    expect(events.filter((event) => event.event === "progress").map((event) => event.processed)).toEqual([0, 1, 5, 10, 15, 20, 25]);
    expect(events.at(-1)).toMatchObject({ event: "summary", selected: 25, processed: 25, cleaned: 25 });
    expect(first.stdout + first.stderr).not.toMatch(/synthetic-cli-key|Artist - Song|openrouter|youtube\.com/);
    const second = await run("youtube-cleanup-titles.mjs", paths.youtubeDbFile, ["--limit", "2"]);
    expect(commandEvents(second.stdout).at(-1)).toMatchObject({ selected: 2, processed: 2, cleaned: 2 });
    const refresh = await run("youtube-cleanup-titles.mjs", paths.youtubeDbFile, ["--limit", "1", "--refresh", "00000000000"]);
    expect(commandEvents(refresh.stdout).at(-1)).toMatchObject({ selected: 1, processed: 1, refreshed: 1 });
    for (const extra of [["--limit", "0"], ["--limit", "101"], ["--refresh", "bad"], ["--limit", "1", "--refresh", "00000000000", "--refresh", "00000000001"]]) {
      const error = await run("youtube-cleanup-titles.mjs", paths.youtubeDbFile, extra).catch((value: unknown) => value);
      expect(error).toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("Usage:") });
    }
    expect(store.getVideoTitle("00000000027").displayTitle).toBeNull();
  });

  it("actual CLI SIGINT aborts an in-flight request, prints partial summary and preserves rerunnable writes", async () => {
    const { store, db, paths } = await fixture();
    store.importConfirmedVideos([{ videoId: "aaaaaaaaaaa", title: "Artist - First" }, { videoId: "bbbbbbbbbbb", title: "Artist - Second" }]);
    const hook = path.join(paths.root, "interrupt-fetch.mjs");
    await writeFile(hook, `let calls = 0; globalThis.fetch = async (_url, options) => {
      if (++calls === 2) return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Synthetic wait expired')), 30000);
        const abort = () => { clearTimeout(timer); reject(new Error('Synthetic abort')); };
        if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
      });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Artist - First' } }] });
    };`);
    const child = spawn(process.execPath, ["--import", hook, "scripts/youtube-cleanup-titles.mjs", "--db", paths.youtubeDbFile], { env: { PATH: process.env.PATH, HOME: paths.root, OPENROUTER_API_KEY: "synthetic-interrupt-key" }, stdio: ["ignore", "pipe", "pipe"] });
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 5_000);
    let stdout = ""; let stderr = ""; let sent = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!sent && stdout.includes('"processed":1')) { sent = true; child.kill("SIGINT"); }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const exited = new Promise<number | null>((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
    try {
      expect(await exited).toBe(130);
      expect(sent).toBe(true); expect(stderr).toBe("");
      expect(commandEvents(stdout).at(-1)).toMatchObject({ event: "summary", selected: 2, processed: 1, cleaned: 1, interrupted: true });
      expect(stdout).not.toContain("synthetic-interrupt-key");
      expect(store.getVideoTitle("aaaaaaaaaaa").displayTitle).toBe("Artist - First");
      expect(store.getVideoTitle("bbbbbbbbbbb").displayTitle).toBeNull();
      expect(db.inTransaction).toBe(false);
      const run = await scriptFixture(paths.root);
      const rerun = await run("youtube-cleanup-titles.mjs", paths.youtubeDbFile);
      expect(commandEvents(rerun.stdout).at(-1)).toMatchObject({ selected: 1, processed: 1, cleaned: 1, interrupted: false });
      expect(store.getVideoTitle("aaaaaaaaaaa").displayTitle).toBe("Artist - First");
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  }, 10_000);
});

describe("YouTube title persistence and explicit cleanup", () => {
  it("adds nullable columns on an old SQLite schema without rewriting existing data", async () => {
    const { store, db, paths } = await fixture();
    store.addToQueue(input);
    store.importConfirmedVideos([{ videoId, title: "Catalog original" }]);
    const queueBefore = db.prepare("select * from youtube_party_queue_items").all();
    for (const column of ["display_title", "playback_title", "playback_subtitle", "playback_album"]) db.exec(`alter table youtube_media drop column ${column}`);
    db.exec("alter table youtube_confirmed_videos drop column display_title");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const reopened = new YoutubeStore(paths);
    try {
      expect(reopened.getQueue().items[0]).toMatchObject({ title: input.title, displayTitle: null });
      expect(db.prepare("select * from youtube_party_queue_items").all()).toEqual(queueBefore);
      expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Catalog original", display_title: null });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { reopened.close(); }
  });
  it("reuses an old-schema uncleaned music row for a bare URL without metadata/provider calls", async () => {
    const { store, db, paths } = await fixture();
    store.addToQueue({ ...input, kind: "music", title: "Song (Live Remix)", artist: "Artist feat. Guest" });
    store.importConfirmedVideos([{ videoId, title: "Independent catalog source" }]);
    store.setAutomationPaused(true);
    const before = store.getQueue();
    for (const column of ["display_title", "playback_title", "playback_subtitle", "playback_album"]) db.exec(`alter table youtube_media drop column ${column}`);
    db.exec("alter table youtube_confirmed_videos drop column display_title");
    const reopened = new YoutubeStore(paths);
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("No external calls permitted"));
    try {
      expect(reopened.getVideoTitle(videoId)).toMatchObject({ title: "Song (Live Remix)", displayTitle: null, kind: "music", artist: "Artist feat. Guest", requiresArtistSong: true, needsCleanup: true });
      const prepared = await new YoutubeTitleService(reopened, fetchMock, () => "synthetic-key").prepare({ sourceId: videoId, url: input.url });
      expect(prepared).toMatchObject({ title: "Song (Live Remix)", displayTitle: "Artist feat. Guest - Song (Live Remix)", kind: "music", artist: "Artist feat. Guest" });
      expect(reopened.getQueue()).toEqual({ ...before, items: before.items.map((item) => ({ ...item, displayTitle: "Artist feat. Guest - Song (Live Remix)" })) });
      expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Independent catalog source", display_title: "Artist feat. Guest - Song (Live Remix)" });
      expect(reopened.isAutomationPaused()).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { reopened.close(); }
  });

  it("preserves originals/display across playback, re-add, catalog/radio/playlist loads and SQLite reopen", async () => {
    const { store, db, paths } = await fixture();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(completion("Artist - Song"));
    const service = new YoutubeTitleService(store, fetchMock, () => "synthetic-key");
    store.addToQueue(await service.prepare(input));
    store.addToQueue(await service.prepare({ ...input, title: "Replacement title" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    store.markPlaying(store.firstPending()!.id);
    store.updateCurrentFromPlayback({ connected: true, state: "playing", title: "TV observation", subtitle: "TV artist", album: "TV album", videoId, packageName: null, positionMs: 0, durationMs: null, checkedAt: new Date().toISOString(), detail: null });
    expect(db.prepare("select title, display_title, playback_title, playback_subtitle, playback_album from youtube_media").get()).toEqual({ title: input.title, display_title: "Artist - Song", playback_title: "TV observation", playback_subtitle: "TV artist", playback_album: "TV album" });
    store.importConfirmedVideos([{ videoId, title: "Catalog source" }]);
    expect(db.prepare("select title, display_title from youtube_confirmed_videos").get()).toEqual({ title: "Catalog source", display_title: "Artist - Song" });
    const playlist = store.createPlaylist("Pippalot");
    db.prepare("update youtube_playlists set id = 'pippalot' where id = ?").run(playlist.id);
    store.addToPippalot({ ...input, title: "Another replacement" });
    store.loadPippalotToQueue(); store.loadPlaylistToQueue("pippalot"); store.loadConfirmedVideosToQueue();
    const reopened = new YoutubeStore(paths);
    try { expect(reopened.getQueue().items[0]).toMatchObject({ title: input.title, displayTitle: "Artist - Song" }); } finally { reopened.close(); }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("covers unique media/full catalog IDs, missing titles, failures and rerun skips without changing identity/state", async () => {
    const { store, db } = await fixture();
    store.addToQueue(input); store.addToQueue(input); store.markPlaying(store.firstPending()!.id); store.setAutomationPaused(true);
    store.importConfirmedVideos([{ videoId, title: "Catalog source" }, { videoId: "Kdg4DLAPC4A" }, { videoId: "NP0H491rRFU", title: "Guide to a Garden" }, { videoId: "Tb0MC0jFv6M", title: "Failure title" }]);
    db.prepare("insert into youtube_confirmed_videos select 'duplicate', video_id, title, channel, channel_id, duration_ms, thumbnail_url, source, confidence, notes, created_at, updated_at, display_title from youtube_confirmed_videos where video_id = ?").run(videoId);
    const playlist = store.createPlaylist("Saved");
    db.prepare("insert into youtube_playlist_items values ('saved-ref', ?, ?, 7, '2026-01-01T00:00:00.000Z')").run(playlist.id, store.firstPending()!.mediaItemId);
    const identity = () => ["youtube_party_queue_items", "youtube_playlist_items", "youtube_playlists", "youtube_meta"].map((table) => db.prepare(`select * from ${table}`).all());
    const before = identity();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      expect(db.inTransaction).toBe(false);
      if (String(url).includes("oembed")) {
        const id = new URL(new URL(String(url)).searchParams.get("url")!).searchParams.get("v");
        return Response.json({ title: id === "NP0H491rRFU" ? "Guide to a Garden" : id === "Tb0MC0jFv6M" ? "Failure title" : "Missing fetched song" });
      }
      const body = JSON.parse(String(options?.body));
      const title = body.messages[1].content;
      if (title === "Failure title") return new Response("", { status: 503 });
      return completion(title === "Guide to a Garden" ? title : "Artist - Song (Live feat. Guest)");
    });
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toEqual({ selected: 4, processed: 4, cleaned: 3, refreshed: 0, skippedSuccessful: 0, fetchedMissing: 1, failed: 1, notFound: 0, interrupted: false });
    expect(identity()).toEqual(before);
    expect(store.getQueue().items.every((item) => item.displayTitle === "Artist - Song (Live feat. Guest)")).toBe(true);
    expect(db.prepare("select title, display_title from youtube_confirmed_videos where video_id = 'NP0H491rRFU'").get()).toEqual({ title: "Guide to a Garden", display_title: "Guide to a Garden" });
    fetchMock.mockClear();
    expect(await cleanupYoutubeTitles(db, {}, fetchMock, () => "synthetic-key")).toEqual({ selected: 1, processed: 1, cleaned: 0, refreshed: 0, skippedSuccessful: 0, fetchedMissing: 0, failed: 1, notFound: 0, interrupted: false });
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(identity()).toEqual(before);
  });

  it("executes the built command twice against a synthetic duplicate/missing-title database", async () => {
    const { store, db, paths } = await fixture();
    store.addToQueue(input); store.addToQueue(input); store.markPlaying(store.firstPending()!.id); store.setAutomationPaused(true);
    store.importConfirmedVideos([{ videoId, title: input.title }, { videoId: "Kdg4DLAPC4A" }]);
    const before = db.prepare("select * from youtube_party_queue_items").all();
    const run = await scriptFixture(paths.root);
    const first = await run("youtube-cleanup-titles.mjs", paths.youtubeDbFile);
    const second = await run("youtube-cleanup-titles.mjs", paths.youtubeDbFile);
    const firstEvents = first.stdout.trim().split("\n").map((line) => JSON.parse(line));
    const secondEvents = second.stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(firstEvents.map((event) => event.event)).toEqual(["progress", "progress", "progress", "summary"]);
    expect(firstEvents.at(-1)).toEqual({ event: "summary", selected: 2, processed: 2, cleaned: 2, refreshed: 0, skippedSuccessful: 0, fetchedMissing: 1, failed: 0, notFound: 0, interrupted: false });
    expect(secondEvents.at(-1)).toEqual({ event: "summary", selected: 0, processed: 0, cleaned: 0, refreshed: 0, skippedSuccessful: 0, fetchedMissing: 0, failed: 0, notFound: 0, interrupted: false });
    expect(first.stderr + second.stderr).toBe("");
    expect(first.stdout + second.stdout).not.toContain("synthetic-cli-key");
    expect(db.prepare("select * from youtube_party_queue_items").all()).toEqual(before);
    expect(store.isAutomationPaused()).toBe(true);
    const missing = await run("youtube-cleanup-titles.mjs", path.join(paths.root, "absent.sqlite")).catch((error: unknown) => error);
    expect(missing).toMatchObject({ code: 1, stderr: "Title cleanup failed. Check the database path and schema.\n" });
  });

  it("manual Pippalot import/backfill preserve successful titles and source values; second append adds zero", async () => {
    const { store, db, paths } = await fixture();
    store.addToQueue({ ...input, displayTitle: "Artist - Song" });
    store.importConfirmedVideos([{ videoId, title: "Catalog original" }]);
    const playlist = store.createPlaylist("Pippalot");
    db.prepare("update youtube_playlists set id = 'pippalot' where id = ?").run(playlist.id);
    const run = await scriptFixture(paths.root);
    const first = JSON.parse((await run("pippalot-import-new.mjs", paths.youtubeDbFile)).stdout);
    const second = JSON.parse((await run("pippalot-import-new.mjs", paths.youtubeDbFile)).stdout);
    expect(first).toMatchObject({ fetched: 1, cachedBefore: 0, added: 1, cachedAfter: 1 });
    expect(second).toMatchObject({ fetched: 1, cachedBefore: 1, added: 0, cachedAfter: 1 });
    expect(first.backupFile).toContain("backup-before-pippalot-import");
    expect(db.prepare("select title, display_title from youtube_media where source_id = 'NP0H491rRFU'").get()).toEqual({ title: input.title, display_title: "Artist - Song (Live feat. Guest)" });
    await run("youtube-backfill-confirmed.mjs", paths.youtubeDbFile);
    expect(db.prepare("select title, display_title, channel from youtube_confirmed_videos").get()).toEqual({ title: "Catalog original", display_title: "Artist - Song", channel: "New Channel" });
    expect((await readFile(first.backupFile)).length).toBeGreaterThan(0);
  });
});
