import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/src/app";
import { ShowStateStore } from "../server/src/services/show-state-store";
import { makeDraft, makeRemoteStatus, makeTempPaths, seedLibrary } from "./test-helpers";

describe("show route", () => {
  it("persists valid draft", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    await seedLibrary(paths, store);
    const app = createApp({
      config: {} as never,
      paths: {} as never,
      store,
      mediaStore: {} as never,
      bundleService: {} as never,
      raspController: { status: async () => makeRemoteStatus() } as never,
      runtime: { applyInProgress: false },
    });

    const response = await request(app)
      .put("/api/show")
      .send(makeDraft({ playlist: [{ id: "item-1", sourceMediaId: "media-1" }] }));

    expect(response.status).toBe(200);
    expect(response.body.draft.playlist).toHaveLength(1);
  });

  it("rejects unknown media ids", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    const app = createApp({
      config: {} as never,
      paths: {} as never,
      store,
      mediaStore: {} as never,
      bundleService: {} as never,
      raspController: { status: async () => makeRemoteStatus() } as never,
      runtime: { applyInProgress: false },
    });

    const response = await request(app)
      .put("/api/show")
      .send(makeDraft({ playlist: [{ id: "item-1", sourceMediaId: "missing" }] }));

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Unknown media id/);
  });
});
