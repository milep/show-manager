import { describe, expect, it } from "vitest";
import type { YoutubePlaybackStatus } from "../shared/show-schema";
import { YoutubeQueueScheduler } from "../server/src/services/youtube-queue-scheduler";
import { makeTempPaths } from "./test-helpers";
import { ShowStateStore } from "../server/src/services/show-state-store";

function playback(overrides: Partial<YoutubePlaybackStatus> = {}): YoutubePlaybackStatus {
  return {
    connected: true,
    state: "idle",
    packageName: "com.google.android.youtube.tv",
    videoId: null,
    title: null,
    subtitle: null,
    positionMs: null,
    durationMs: null,
    checkedAt: new Date().toISOString(),
    detail: null,
    ...overrides,
  };
}

describe("YoutubeQueueScheduler", () => {
  it("starts first queued item", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    await store.saveYoutubeQueue({
      items: [
        {
          id: "item-1",
          videoId: "GF3wagWwHjM",
          url: "https://www.youtube.com/watch?v=GF3wagWwHjM",
          title: null,
          subtitle: null,
          addedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        },
      ],
      currentItemId: null,
      updatedAt: new Date().toISOString(),
    });
    const played: string[] = [];
    const scheduler = new YoutubeQueueScheduler(store, {
      getPlaybackStatus: async () => playback({ state: "idle" }),
      playVideo: async (videoId: string) => {
        played.push(videoId);
      },
    } as never);

    await scheduler.tick();

    const queue = await store.getYoutubeQueue();
    expect(queue.currentItemId).toBe("item-1");
    expect(queue.items[0]?.startedAt).not.toBeNull();
    expect(played).toEqual(["GF3wagWwHjM"]);
    expect(scheduler.getCachedPlaybackStatus()?.state).toBe("buffering");
    expect(scheduler.getCachedPlaybackStatus()?.videoId).toBe("GF3wagWwHjM");
  });

  it("advances ended item", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    const oldStartedAt = new Date(Date.now() - 30_000).toISOString();
    await store.saveYoutubeQueue({
      items: [
        {
          id: "item-1",
          videoId: "GF3wagWwHjM",
          url: "https://www.youtube.com/watch?v=GF3wagWwHjM",
          title: null,
          subtitle: null,
          addedAt: new Date().toISOString(),
          startedAt: oldStartedAt,
          completedAt: null,
        },
        {
          id: "item-2",
          videoId: "Kdg4DLAPC4A",
          url: "https://www.youtube.com/watch?v=Kdg4DLAPC4A",
          title: null,
          subtitle: null,
          addedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        },
      ],
      currentItemId: "item-1",
      updatedAt: new Date().toISOString(),
    });
    const played: string[] = [];
    const scheduler = new YoutubeQueueScheduler(store, {
      getPlaybackStatus: async () => playback({ state: "idle" }),
      playVideo: async (videoId: string) => {
        played.push(videoId);
      },
    } as never);

    await scheduler.tick();

    const queue = await store.getYoutubeQueue();
    expect(queue.items[0]?.completedAt).not.toBeNull();
    expect(queue.currentItemId).toBe("item-2");
    expect(played).toEqual(["Kdg4DLAPC4A"]);
  });
});
