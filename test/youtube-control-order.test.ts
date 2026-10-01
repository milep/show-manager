import { rm } from "node:fs/promises";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, createAppServices } from "../server/src/app";
import type { YoutubePlaybackStatus } from "../shared/show-schema";
import { YoutubeQueueScheduler } from "../server/src/services/youtube-queue-scheduler";
import { YoutubeStore } from "../server/src/services/youtube-store";
import { makeConfig, makeTempPaths } from "./test-helpers";

const roots: string[] = [];
const stores: YoutubeStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const paths = await makeTempPaths();
  roots.push(paths.root);
  const services = createAppServices(makeConfig(paths.root), paths);
  stores.push(services.youtubeStore);
  const events: string[] = [];
  const playback: YoutubePlaybackStatus = {
    connected: true, state: "idle", packageName: null, videoId: null,
    title: null, subtitle: null, album: null, positionMs: null, durationMs: null,
    checkedAt: new Date().toISOString(), detail: null,
  };
  vi.spyOn(services.adbYoutubeController, "getPlaybackStatus").mockImplementation(async () => ({ ...playback, checkedAt: new Date().toISOString() }));
  const launch = vi.spyOn(services.adbYoutubeController, "playVideo").mockImplementation(async (id) => {
    events.push(`launch:${id}`); playback.state = "playing";
  });
  const pause = vi.spyOn(services.adbYoutubeController, "pause").mockImplementation(async () => {
    events.push("pause"); playback.state = "paused";
  });
  const play = vi.spyOn(services.adbYoutubeController, "play").mockImplementation(async () => { events.push("play"); });
  const add = (id: string) => services.youtubeStore.addToQueue({ sourceId: id, url: `https://youtu.be/${id}` });
  return { services, paths, events, playback, launch, pause, play, add, app: createApp(services), scheduler: services.youtubeQueueScheduler, store: services.youtubeStore };
}

describe("authoritative YouTube control ordering", () => {
  it("serializes HTTP skip and presenter pause behind an in-flight tick without losing either", async () => {
    const f = await fixture();
    for (const id of ["GF3wagWwHjM", "Kdg4DLAPC4A", "NP0H491rRFU"]) f.add(id);
    const barrier = deferred();
    f.launch.mockImplementationOnce(async (id) => {
      f.events.push(`launch:${id}`); await barrier.promise; f.playback.state = "playing";
    });
    const tick = f.scheduler.tick();
    await vi.waitFor(() => expect(f.launch).toHaveBeenCalledTimes(1));
    const control = vi.spyOn(f.scheduler, "control");
    const skip = request(f.app).post("/api/youtube-queue/skip").send({}).then((response) => response);
    await vi.waitFor(() => expect(control).toHaveBeenCalledWith("next"));
    const pause = f.scheduler.control("pause");
    const laterTick = f.scheduler.tick();
    barrier.resolve();
    const [response] = await Promise.all([skip, tick, pause, laterTick]);
    expect(response.status).toBe(200);
    expect(f.events).toEqual(["launch:GF3wagWwHjM", "launch:Kdg4DLAPC4A", "pause"]);
    expect(f.store.listCompletedQueueItems().map((item) => item.videoId)).toEqual(["GF3wagWwHjM"]);
    expect(f.store.getQueue().items.map((item) => item.videoId)).toEqual(["Kdg4DLAPC4A", "NP0H491rRFU"]);
    expect(f.store.isAutomationPaused()).toBe(true);
  });

  it("does not coalesce consecutive skips with scheduler ticks", async () => {
    const f = await fixture();
    for (const id of ["GF3wagWwHjM", "Kdg4DLAPC4A", "NP0H491rRFU"]) f.add(id);
    await f.scheduler.tick();
    await Promise.all([f.scheduler.control("next"), f.scheduler.control("next"), f.scheduler.tick()]);
    expect(f.events).toEqual(["launch:GF3wagWwHjM", "launch:Kdg4DLAPC4A", "launch:NP0H491rRFU"]);
    expect(f.store.listCompletedQueueItems().map((item) => item.videoId)).toEqual(["GF3wagWwHjM", "Kdg4DLAPC4A"]);
    expect(f.store.getQueue().items.map((item) => item.videoId)).toEqual(["NP0H491rRFU"]);
  });

  it.each(["remove", "clear", "radio", "playlist", "add-next", "shuffle", "pippalot-missing"] as const)(
    "%s cannot mutate an in-flight selection before it is committed", async (operation) => {
      const f = await fixture();
      f.add("GF3wagWwHjM"); f.add("Kdg4DLAPC4A");
      const selected = f.store.firstPending()!;
      f.store.importConfirmedVideos([{ videoId: "NP0H491rRFU" }]);
      const playlist = f.store.createPlaylist("empty fixture");
      const barrier = deferred();
      f.launch.mockImplementationOnce(async (id) => { f.events.push(`launch:${id}`); await barrier.promise; });
      const tick = f.scheduler.tick();
      await vi.waitFor(() => expect(f.launch).toHaveBeenCalledTimes(1));
      const mutations = {
        remove: () => f.scheduler.removeQueueItem(selected.id),
        clear: () => f.scheduler.clearQueue(),
        radio: () => f.scheduler.loadRadio(),
        playlist: () => f.scheduler.loadPlaylist(playlist.id, "replace"),
        "add-next": () => f.scheduler.addToQueue({ sourceId: "NP0H491rRFU", url: "https://youtu.be/NP0H491rRFU" }, "next"),
        shuffle: () => f.scheduler.shuffleRest(),
        "pippalot-missing": () => f.scheduler.loadPippalot(),
      };
      const mutation = mutations[operation]().catch((error: unknown) => error);
      await Promise.resolve();
      expect(f.store.getQueue().items.map((item) => item.videoId)).toEqual(["GF3wagWwHjM", "Kdg4DLAPC4A"]);
      expect(f.store.getQueue().currentItemId).toBeNull();
      barrier.resolve();
      await tick;
      const result = await mutation;
      const ids = f.store.getQueue().items.map((item) => item.videoId);
      if (operation === "clear" || operation === "playlist") expect(ids).toEqual([]);
      else if (operation === "radio") expect(ids).toEqual(["NP0H491rRFU"]);
      else if (operation === "add-next") expect(ids).toEqual(["GF3wagWwHjM", "NP0H491rRFU", "Kdg4DLAPC4A"]);
      else expect(ids).toEqual(["GF3wagWwHjM", "Kdg4DLAPC4A"]);
      if (operation === "clear") expect(f.events).toEqual(["launch:GF3wagWwHjM", "pause"]);
      if (operation === "pippalot-missing") expect(result).toBeInstanceOf(Error);
    },
  );

  it("pause persists only after ADB succeeds, keeps current track, and survives reopen", async () => {
    const f = await fixture();
    f.add("GF3wagWwHjM"); f.add("Kdg4DLAPC4A");
    await f.scheduler.tick();
    const current = f.store.getQueue().currentItemId;
    f.pause.mockRejectedValueOnce(new Error("fixture pause failed"));
    await expect(f.scheduler.control("pause")).rejects.toThrow("fixture pause failed");
    expect(f.store.isAutomationPaused()).toBe(false);
    await f.scheduler.control("pause");
    expect(f.store.getQueue().currentItemId).toBe(current);
    f.store.close(); stores.splice(stores.indexOf(f.store), 1);
    const reopened = new YoutubeStore(f.paths); stores.push(reopened);
    expect(reopened.isAutomationPaused()).toBe(true);
    f.playback.state = "idle";
    const scheduler = new YoutubeQueueScheduler(reopened, f.services.adbYoutubeController);
    await scheduler.tick();
    expect(reopened.getQueue().currentItemId).toBe(current);
    expect(reopened.getQueue().items.map((item) => item.videoId)).toEqual(["GF3wagWwHjM", "Kdg4DLAPC4A"]);
    expect(f.launch).toHaveBeenCalledTimes(1);
  });

  it("HTTP play resumes intent before failed ADB; next retries failed launch without stopping TV", async () => {
    const f = await fixture();
    f.store.setAutomationPaused(true);
    f.play.mockRejectedValueOnce(new Error("fixture play failed"));
    const response = await request(f.app).post("/api/youtube-playback/play");
    expect(response.status).toBe(500);
    expect(f.store.isAutomationPaused()).toBe(false);
    f.add("GF3wagWwHjM"); f.add("Kdg4DLAPC4A");
    await f.scheduler.tick();
    f.launch.mockRejectedValueOnce(new Error("fixture launch failed"));
    await f.scheduler.control("next");
    expect(f.scheduler.status().lastError).toBe("fixture launch failed");
    expect(f.store.getQueue().currentItemId).toBeNull();
    expect(f.store.firstPending()?.videoId).toBe("Kdg4DLAPC4A");
    await f.scheduler.tick();
    expect(f.store.getQueue().items[0]?.videoId).toBe("Kdg4DLAPC4A");
    await f.scheduler.control("next");
    expect(f.store.getQueue().items).toEqual([]);
    expect(f.pause).not.toHaveBeenCalled();
  });

  it("clear failure and missing Pippalot keep their existing resume-first semantics", async () => {
    const f = await fixture();
    f.store.setAutomationPaused(true); f.add("GF3wagWwHjM");
    await expect(f.scheduler.loadPippalot()).rejects.toThrow("not cached");
    expect(f.store.isAutomationPaused()).toBe(false);
    expect(f.store.getQueue().items).toHaveLength(1);
    f.store.setAutomationPaused(true);
    f.pause.mockRejectedValueOnce(new Error("fixture pause failed"));
    await expect(f.scheduler.clearQueue()).rejects.toThrow("fixture pause failed");
    expect(f.store.isAutomationPaused()).toBe(false);
    expect(f.store.getQueue().items).toEqual([]);
  });

  it("discarded presenter work never resumes paused intent; stop drains active work", async () => {
    const f = await fixture();
    f.store.setAutomationPaused(true);
    await f.scheduler.control("next", () => false);
    await f.scheduler.control("play", () => false);
    expect(f.store.isAutomationPaused()).toBe(true);
    expect(f.launch).not.toHaveBeenCalled(); expect(f.play).not.toHaveBeenCalled();
    const barrier = deferred();
    f.pause.mockImplementationOnce(() => barrier.promise);
    const pause = f.scheduler.control("pause");
    let drained = false;
    const stop = f.scheduler.stop().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    barrier.resolve(); await Promise.all([pause, stop]);
    expect(drained).toBe(true);
  });
});
