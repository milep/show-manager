import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/src/app";
import { ShowStateStore } from "../server/src/services/show-state-store";
import { makeDraft, makeLastApplied, makeRemoteStatus, makeTempPaths, seedLibrary } from "./test-helpers";

describe("apply route", () => {
  it("returns deterministic success shape", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    await seedLibrary(paths, store);
    await store.saveDraftShow(makeDraft({ playlist: [{ id: "item-1", sourceMediaId: "media-1" }] }));
    await store.saveLastApplied(makeLastApplied());
    const app = createApp({
      config: {} as never,
      paths,
      store,
      mediaStore: {} as never,
      bundleService: { build: vi.fn(async () => ({ applyId: "apply-2", applyDir: "/tmp/a", mediaDir: "/tmp/a/media", playlistPath: "/tmp/a/playlist.txt", launchScriptPath: "/tmp/a/launch-player.sh", runScriptPath: "/tmp/a/run-show.sh", draftHash: "hash-2" })) } as never,
      raspController: {
        applyBundle: vi.fn(async () => makeLastApplied({ applyId: "apply-2", draftHash: "hash-2" })),
        status: vi.fn(async () => makeRemoteStatus({ state: "running", activeReleaseId: "apply-2", pid: 99 })),
      } as never,
      runtime: { applyInProgress: false },
    });

    const response = await request(app).post("/api/show/apply");
    expect(response.status).toBe(200);
    expect(response.body.remoteStatus.state).toBe("running");
  });

  it("returns failure shape on apply error", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    await seedLibrary(paths, store);
    await store.saveDraftShow(makeDraft({ playlist: [{ id: "item-1", sourceMediaId: "media-1" }] }));
    const app = createApp({
      config: {} as never,
      paths,
      store,
      mediaStore: {} as never,
      bundleService: { build: vi.fn(async () => ({ applyId: "apply-2", applyDir: "/tmp/a", mediaDir: "/tmp/a/media", playlistPath: "/tmp/a/playlist.txt", launchScriptPath: "/tmp/a/launch-player.sh", runScriptPath: "/tmp/a/run-show.sh", draftHash: "hash-2" })) } as never,
      raspController: {
        applyBundle: vi.fn(async () => {
          throw new Error("ssh failed");
        }),
        status: vi.fn(async () => makeRemoteStatus({ state: "error" })),
      } as never,
      runtime: { applyInProgress: false },
    });

    const response = await request(app).post("/api/show/apply");
    expect(response.status).toBe(500);
    expect(response.body.remoteStatus.state).toBe("error");
  });
});
