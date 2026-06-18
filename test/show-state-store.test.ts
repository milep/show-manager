import { describe, expect, it } from "vitest";
import { ShowStateStore, hashDraftShow } from "../server/src/services/show-state-store";
import { makeDraft, makeTempPaths } from "./test-helpers";

describe("ShowStateStore", () => {
  it("persists draft state", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    const draft = makeDraft({ playlist: [{ id: "item-1", sourceMediaId: "media-1" }] });
    await store.saveDraftShow(draft);
    await expect(store.getDraftShow()).resolves.toEqual(draft);
    expect(hashDraftShow(draft)).toHaveLength(16);
  });

  it("persists youtube queue state", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    const queue = {
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
    };
    await store.saveYoutubeQueue(queue);
    await expect(store.getYoutubeQueue()).resolves.toEqual(queue);
  });

  it("returns empty youtube queue when missing", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    const queue = await store.getYoutubeQueue();
    expect(queue.items).toEqual([]);
    expect(queue.currentItemId).toBeNull();
  });

  it("rejects invalid library shape", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    await expect(store.saveLibrary({ items: [{ id: "bad" }] } as never)).rejects.toThrow();
  });
});
