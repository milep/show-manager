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


  it("rejects invalid library shape", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    await expect(store.saveLibrary({ items: [{ id: "bad" }] } as never)).rejects.toThrow();
  });
});
