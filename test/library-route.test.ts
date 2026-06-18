import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/src/app";
import { makeDraft, makeRemoteStatus } from "./test-helpers";

describe("library route", () => {
  it("lists library items", async () => {
    const app = createApp({
      config: { maxUploadBytes: 1000 } as never,
      paths: {} as never,
      store: {
        getDraftShow: async () => makeDraft(),
        getLastApplied: async () => null,
        getLibrary: async () => ({ items: [{ id: "media-1" }] }),
      } as never,
      mediaStore: { saveUpload: vi.fn() } as never,
      bundleService: {} as never,
      raspController: { status: async () => makeRemoteStatus() } as never,
      runtime: { applyInProgress: false },
    });

    const response = await request(app).get("/api/library");
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
  });
});
