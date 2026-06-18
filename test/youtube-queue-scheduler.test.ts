import { describe, expect, it } from "vitest";
import type { YoutubePlaybackStatus } from "../shared/show-schema";
import { YoutubeQueueScheduler } from "../server/src/services/youtube-queue-scheduler";
import { YoutubeStore } from "../server/src/services/youtube-store";
import { makeTempPaths } from "./test-helpers";

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
  it("starts first queued item", async () => {
    const store = new YoutubeStore(await makeTempPaths());
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
    const store = new YoutubeStore(await makeTempPaths());
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

  it("keeps newly started item during startup grace", async () => {
    const store = new YoutubeStore(await makeTempPaths());
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
