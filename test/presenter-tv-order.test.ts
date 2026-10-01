import Database from "better-sqlite3";
import { rm } from "node:fs/promises";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, createAppServices } from "../server/src/app";
import { YoutubeStore } from "../server/src/services/youtube-store";
import { makeConfig, makeTempPaths } from "./test-helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const clean of cleanup.splice(0)) await clean(); vi.restoreAllMocks(); });
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function fixture(cache: "full" | "empty" | "missing" = "full") {
  const paths = await makeTempPaths();
  const services = createAppServices(makeConfig(paths.root), paths);
  const store = services.youtubeStore;
  cleanup.push(async () => { await services.youtubeQueueScheduler.stop(); store.close(); await rm(paths.root, { recursive: true, force: true }); });
  const events: string[] = [];
  const adb = services.adbYoutubeController;
  const prepare = vi.spyOn(adb, "prepareYoutube").mockImplementation(async () => { events.push("ready"); });
  const power = vi.spyOn(adb, "getPowerState").mockImplementation(async () => { events.push("power"); return "awake"; });
  const pause = vi.spyOn(adb, "pause").mockImplementation(async () => { events.push("pause"); });
  const sleep = vi.spyOn(adb, "sleepAndVerify").mockImplementation(async () => { expect(store.isAutomationPaused()).toBe(true); events.push("sleep-verified"); });
  const toggle = vi.spyOn(adb, "togglePower").mockImplementation(async () => { events.push("raw-toggle"); });
  const status = vi.spyOn(adb, "getPlaybackStatus").mockResolvedValue({ connected: true, state: "idle", packageName: null, videoId: null, title: null, subtitle: null,
    album: null, positionMs: null, durationMs: null, checkedAt: new Date().toISOString(), detail: null });
  const launch = vi.spyOn(adb, "playVideo").mockImplementation(async (id) => { events.push(`launch:${id}`); });
  store.addToQueue({ sourceId: "Tb0MC0jFv6M", url: "https://youtu.be/Tb0MC0jFv6M" });
  store.markPlaying(store.firstPending()!.id); store.setAutomationPaused(true);
  if (cache !== "missing") {
    const db = new Database(paths.youtubeDbFile);
    db.prepare("insert into youtube_playlists (id, name, created_at, updated_at) values ('pippalot', 'Pippalot', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
    db.close();
    if (cache === "full") for (const id of ["GF3wagWwHjM", "Kdg4DLAPC4A", "NP0H491rRFU"]) store.addToPippalot({ sourceId: id, url: `https://youtu.be/${id}` });
  }
  const load = vi.spyOn(store, "loadPippalotToQueue");
  return { services, scheduler: services.youtubeQueueScheduler, app: createApp(services), store, paths, events, prepare, power, pause, sleep, toggle, status, launch, load };
}

describe("presenter TV scheduler ownership", () => {
  it("prepares before one shared cached shuffle/replace/start; matches browser order for identical randomness", async () => {
    const f = await fixture();
    const barrier = deferred();
    const before = f.store.getQueue();
    f.prepare.mockImplementationOnce(async () => { f.events.push("prepare"); await barrier.promise; f.events.push("ready"); });
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    let entryChecks = 0;
    const start = f.scheduler.control("start-pippalot", () => { entryChecks += 1; return true; });
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledTimes(1));
    expect(f.store.getQueue()).toEqual(before); expect(f.store.isAutomationPaused()).toBe(true);
    expect(f.load).not.toHaveBeenCalled();
    barrier.resolve(); await start;
    const presenterOrder = f.store.getQueue().items.map((item) => item.videoId);
    expect(entryChecks).toBe(1); expect(f.load).toHaveBeenCalledTimes(1); expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.events.slice(0, 2)).toEqual(["prepare", "ready"]);
    expect(f.store.isAutomationPaused()).toBe(false);
    expect(await f.scheduler.loadPippalot()).toEqual({ queued: 3 });
    expect(f.store.getQueue().items.map((item) => item.videoId)).toEqual(presenterOrder);
    expect(f.load).toHaveBeenCalledTimes(2); expect(f.launch).toHaveBeenCalledTimes(2);
  });

  it.each(["missing", "empty"] as const)("%s cache preserves old queue AND persisted pause", async (cache) => {
    const f = await fixture(cache); const before = f.store.getQueue();
    await expect(f.scheduler.control("start-pippalot")).rejects.toThrow(cache === "missing" ? "not cached" : "empty");
    expect(f.store.getQueue()).toEqual(before); expect(f.store.isAutomationPaused()).toBe(true);
    expect(f.launch).not.toHaveBeenCalled(); expect(f.scheduler.status().lastError).toMatch(/cached|empty/);
  });

  it.each(["offline", "unknown power", "readiness deadline", "native app failed"])("%s preparation keeps queue/pause and reports failure", async (failure) => {
    const f = await fixture(); const before = f.store.getQueue();
    f.prepare.mockRejectedValueOnce(new Error(failure));
    await expect(f.scheduler.control("start-pippalot")).rejects.toThrow(failure);
    expect(f.store.getQueue()).toEqual(before); expect(f.store.isAutomationPaused()).toBe(true);
    expect(f.load).not.toHaveBeenCalled(); expect(f.scheduler.status().lastError).toBe(failure);
  });

  it("post-commit launch failure retains existing pending queue/retry semantics, no rollback", async () => {
    const f = await fixture(); f.launch.mockRejectedValueOnce(new Error("launch failed"));
    await f.scheduler.control("start-pippalot");
    expect(f.load).toHaveBeenCalledTimes(1); expect(f.store.getQueue().items).toHaveLength(3);
    expect(f.store.getQueue().currentItemId).toBeNull(); expect(f.store.isAutomationPaused()).toBe(false);
    expect(f.scheduler.status().lastError).toBe("launch failed");
    await f.scheduler.tick(); expect(f.store.getQueue().currentItemId).not.toBeNull();
    expect(f.load).toHaveBeenCalledTimes(1); expect(f.launch).toHaveBeenCalledTimes(2);
  });

  it.each(["awake", "asleep", "dreaming"] as const)("off from %s keeps queue/current; persists pause before verified sleep and reopen", async (state) => {
    const f = await fixture(); f.store.setAutomationPaused(false); const before = f.store.getQueue();
    f.power.mockImplementationOnce(async () => { f.events.push("power"); return state; });
    const persist = vi.spyOn(f.store, "setAutomationPaused").mockImplementation((paused) => {
      expect(f.events).toEqual(state === "asleep" ? ["power"] : ["power", "pause"]);
      persist.mockRestore(); f.store.setAutomationPaused(paused); f.events.push("persist");
    });
    await f.scheduler.control("pause-tv-off");
    expect(f.events).toEqual(state === "asleep" ? ["power", "persist", "sleep-verified"] : ["power", "pause", "persist", "sleep-verified"]);
    expect(f.store.getQueue()).toEqual(before); expect(f.prepare).not.toHaveBeenCalled(); expect(f.toggle).not.toHaveBeenCalled();
    const reopened = new YoutubeStore(f.paths);
    try { expect(reopened.isAutomationPaused()).toBe(true); expect(reopened.getQueue()).toEqual(before); } finally { reopened.close(); }
  });

  it.each([
    ["awake", "power"], ["awake", "pause"], ["awake", "sleep"],
    ["dreaming", "power"], ["dreaming", "pause"], ["dreaming", "sleep"],
  ] as const)("%s %s failure does not falsely claim off or clear queue", async (state, stage) => {
    const f = await fixture(); f.store.setAutomationPaused(false); const before = f.store.getQueue();
    f.power.mockResolvedValue(state);
    ({ power: f.power, pause: f.pause, sleep: f.sleep }[stage]).mockRejectedValueOnce(new Error(`${stage} failed`));
    await expect(f.scheduler.control("pause-tv-off")).rejects.toThrow(`${stage} failed`);
    expect(f.store.getQueue()).toEqual(before); expect(f.store.isAutomationPaused()).toBe(stage === "sleep");
    if (stage !== "sleep") expect(f.sleep).not.toHaveBeenCalled();
    if (stage === "power") expect(f.pause).not.toHaveBeenCalled();
    expect(f.toggle).not.toHaveBeenCalled();
  });

  it.each(["off", "toggle", "disconnect", "stop"] as const)("%s aborts active prep and waits for teardown before subsequent work", async (operation) => {
    const f = await fixture(); const before = f.store.getQueue(); const teardown = deferred(); const lifetime = new AbortController();
    let cancelled = false;
    f.prepare.mockImplementationOnce((signal) => new Promise((_resolve, reject) => {
      f.events.push("preparing");
      signal!.addEventListener("abort", () => {
        cancelled = true;
        void teardown.promise.then(() => { f.events.push("prep-closed"); reject(new Error("prep cancelled")); });
      }, { once: true });
    }));
    const start = expect(f.scheduler.control("start-pippalot", () => true, lifetime.signal)).rejects.toThrow("prep cancelled");
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledTimes(1));
    let later: Promise<unknown>;
    let offFrameFresh = true;
    if (operation === "off") later = f.scheduler.control("pause-tv-off", () => offFrameFresh);
    else if (operation === "toggle") later = request(f.app).post("/api/tv/power-toggle").send({}).then((response) => { expect(response.status).toBe(200); expect(response.body).toEqual({ ok: true }); });
    else if (operation === "stop") later = f.scheduler.stop();
    else { lifetime.abort(); later = Promise.resolve(); }
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(f.store.getQueue()).toEqual(before); expect(f.pause).not.toHaveBeenCalled(); expect(f.toggle).not.toHaveBeenCalled();
    offFrameFresh = false; // Remote failure guard may take 11s: accepted Off must not expire.
    teardown.resolve(); await Promise.all([start, later]);
    expect(f.load).not.toHaveBeenCalled(); expect(f.store.getQueue()).toEqual(before);
    expect(f.events[1]).toBe("prep-closed");
    if (operation === "off") expect(f.events.slice(2)).toEqual(["power", "pause", "sleep-verified"]);
    if (operation === "toggle") expect(f.events.slice(2)).toEqual(["raw-toggle"]);
  });

  it("off cancels pending starts before they enter readiness; queued edits/ticks remain serialized", async () => {
    const f = await fixture(); const barrier = deferred(); const before = f.store.getQueue();
    f.status.mockImplementationOnce(async () => { await barrier.promise; return { connected: false, state: "error", packageName: null, videoId: null, title: null, subtitle: null, album: null,
      positionMs: null, durationMs: null, checkedAt: new Date().toISOString(), detail: "synthetic" }; });
    const tick = f.scheduler.tick();
    const pending = expect(f.scheduler.control("start-pippalot")).rejects.toThrow("superseded");
    const off = f.scheduler.control("pause-tv-off");
    barrier.resolve(); await Promise.all([tick, pending, off]);
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.store.getQueue()).toEqual(before);
    expect(f.store.isAutomationPaused()).toBe(true);
  });

  it("entry-expired and disconnected pending frames do not prepare or mutate; stop cancels pending starts", async () => {
    const f = await fixture(); const before = f.store.getQueue();
    await f.scheduler.control("start-pippalot", () => false);
    const lifetime = new AbortController(); lifetime.abort();
    await expect(f.scheduler.control("start-pippalot", () => true, lifetime.signal)).rejects.toThrow();
    const start = expect(f.scheduler.control("start-pippalot")).rejects.toThrow("stopped");
    await Promise.all([start, f.scheduler.stop()]);
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.store.getQueue()).toEqual(before); expect(f.store.isAutomationPaused()).toBe(true);
  });
});
