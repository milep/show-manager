import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/src/app";
import { makeDraft, makeLastApplied, makeRemoteStatus } from "./test-helpers";

describe("status route", () => {
  it("returns deterministic status shape", async () => {
    const app = createApp({
      config: {} as never,
      paths: {} as never,
      store: {
        getDraftShow: async () => makeDraft(),
        getLastApplied: async () => makeLastApplied({ draftHash: "other" }),
        getLibrary: async () => ({ items: [] }),
      } as never,
      mediaStore: {} as never,
      bundleService: {} as never,
      raspController: { status: async () => makeRemoteStatus({ state: "running" }) } as never,
      runtime: { applyInProgress: true },
    });

    const response = await request(app).get("/api/status");
    expect(response.status).toBe(200);
    expect(response.body.remoteStatus.state).toBe("running");
    expect(response.body.applyInProgress).toBe(true);
    expect(response.body).toHaveProperty("draftHash");
  });
});
