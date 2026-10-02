import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { YoutubePlaybackStatus } from "../shared/show-schema";
import { YoutubeQueueScheduler } from "../server/src/services/youtube-queue-scheduler";
import { YoutubeStore } from "../server/src/services/youtube-store";
import { makeTempPaths as makeFixturePaths } from "./test-helpers";

const fixtures: Array<{ root: string; store: YoutubeStore }> = [];
async function makeStore(): Promise<YoutubeStore> {
  const paths = await makeFixturePaths();
  const store = new YoutubeStore(paths);
  fixtures.push({ root: paths.root, store });
  return store;
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function playback(overrides: Partial<YoutubePlaybackStatus> = {}): YoutubePlaybackStatus {
  return {
    connected: true,
    state: "idle",
    packageName: "com.google.android.youtube.tv",
    videoId: null,
    title: null,
    subtitle: null,
    album: null,
    positionMs: null,
    durationMs: null,
    checkedAt: new Date().toISOString(),
    detail: null,
    ...overrides,
  };
}

describe("YoutubeQueueScheduler", () => {
  it("serializes edits behind playback launch and rechecks pending targets", async () => {
    const store = await makeStore();
    const input = { sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" };
    for (let index = 0; index < 3; index += 1) store.addToQueue(input);
    const [first, second, third] = store.getQueue().items;
    if (!first || !second || !third) throw new Error("Expected queue.");
    let releaseLaunch = () => {};
    const launch = new Promise<void>((resolve) => { releaseLaunch = resolve; });
    let notifyLaunch = () => {};
    const launching = new Promise<void>((resolve) => { notifyLaunch = resolve; });
    const scheduler = new YoutubeQueueScheduler(store, {
      getPlaybackStatus: async () => playback(),
      playVideo: async () => { notifyLaunch(); await launch; },
    } as never);
    const tick = scheduler.tick();
    await launching;
    const protectedMove = scheduler.moveQueueItem(first.id, "down");
    const protectedRemove = scheduler.removeQueueItem(first.id);
    const swap = scheduler.moveQueueItem(third.id, "up");
    expect(store.getQueue().items).toEqual([first, second, third]);
    releaseLaunch();
    await Promise.all([tick, protectedMove, protectedRemove, swap]);
    const queue = store.getQueue();
    expect(queue.currentItemId).toBe(first.id);
    expect(queue.items.map((item) => item.id)).toEqual([first.id, third.id, second.id]);
    expect(queue.items[0]?.startedAt).not.toBeNull();
    expect(queue.items.slice(1)).toEqual([third, second]);
  });

  it("starts first queued item", async () => {
    const store = await makeStore();
    store.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });
    const played: string[] = [];
    const scheduler = new YoutubeQueueScheduler(store, {
      getPlaybackStatus: async () => playback({ state: "idle" }),
      playVideo: async (videoId: string) => {
        played.push(videoId);
      },
    } as never);

    await scheduler.tick();

    const queue = store.getQueue();
    expect(queue.currentItemId).not.toBeNull();
    expect(queue.items[0]?.startedAt).not.toBeNull();
    expect(played).toEqual(["GF3wagWwHjM"]);
    expect(scheduler.getCachedPlaybackStatus()?.state).toBe("buffering");
    expect(scheduler.getCachedPlaybackStatus()?.videoId).toBe("GF3wagWwHjM");
  });

  it("does not mark item playing when ADB launch fails", async () => {
    const store = await makeStore();
    store.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });
    const scheduler = new YoutubeQueueScheduler(store, {
      getPlaybackStatus: async () => playback({ state: "idle" }),
      playVideo: async () => {
        throw new Error("adb failed");
      },
    } as never);

    await scheduler.tick();

    const queue = store.getQueue();
    expect(queue.currentItemId).toBeNull();
    expect(queue.items[0]?.videoId).toBe("GF3wagWwHjM");
    expect(scheduler.status().lastError).toBe("adb failed");
  });

  it("does not advance while manually paused", async () => {
    const store = await makeStore();
    store.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });
    store.addToQueue({ sourceId: "Kdg4DLAPC4A", url: "https://www.youtube.com/watch?v=Kdg4DLAPC4A" });
    const pending = store.firstPending();
    if (!pending) throw new Error("Expected pending item.");
    store.markPlaying(pending.id);
    const played: string[] = [];
    const scheduler = new YoutubeQueueScheduler(store, {
      getPlaybackStatus: async () => playback({ state: "idle" }),
      playVideo: async (videoId: string) => {
        played.push(videoId);
      },
    } as never);
    store.setAutomationPaused(true);

    await scheduler.tick();

    const queue = store.getQueue();
    expect(queue.currentItemId).toBe(pending.id);
    expect(queue.items.map((item) => item.videoId)).toEqual(["GF3wagWwHjM", "Kdg4DLAPC4A"]);
    expect(played).toEqual([]);
  });

  it("keeps newly started item during startup grace", async () => {
    const store = await makeStore();
    store.addToQueue({ sourceId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM" });
    store.addToQueue({ sourceId: "Kdg4DLAPC4A", url: "https://www.youtube.com/watch?v=Kdg4DLAPC4A" });
    const pending = store.firstPending();
    if (!pending) throw new Error("Expected pending item.");
    store.markPlaying(pending.id);
    const played: string[] = [];
    const scheduler = new YoutubeQueueScheduler(store, {
      getPlaybackStatus: async () => playback({ state: "idle" }),
      playVideo: async (videoId: string) => {
        played.push(videoId);
      },
    } as never);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await scheduler.tick();

    const queue = store.getQueue();
    expect(queue.currentItemId).not.toBeNull();
    expect(queue.items[0]?.videoId).toBe("GF3wagWwHjM");
    expect(played).toEqual([]);
  });
});
