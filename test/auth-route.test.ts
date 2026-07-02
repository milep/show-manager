import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAppServices, createApp } from "../server/src/app";
import { makeConfig, makeTempPaths } from "./test-helpers";

describe.sequential("auth routes", () => {
  it("requires qr session for public api requests", async () => {
    const paths = await makeTempPaths();
    const services = createAppServices(makeConfig(paths.root), paths);
    const app = createApp(services);

    const response = await request(app).get("/api/show").set("x-show-manager-access", "public");

    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/QR login/);
  });

  it("blocks public qr toggle without session", async () => {
    const paths = await makeTempPaths();
    const services = createAppServices(makeConfig(paths.root), paths);
    const app = createApp(services);

    const response = await request(app).put("/api/auth/qr-display").set("x-show-manager-access", "public").send({ active: true });

    expect(response.status).toBe(401);
  });

  it("allows public playlist requests after qr login", async () => {
    const paths = await makeTempPaths();
    const services = createAppServices(makeConfig(paths.root), paths);
    services.raspController.showQrCode = vi.fn(async () => undefined);
    services.raspController.hideQrCode = vi.fn(async () => undefined);
    services.adbYoutubeController.getPlaybackStatus = vi.fn(async () => ({
      connected: false,
      state: "idle",
      packageName: null,
      videoId: null,
      title: null,
      subtitle: null,
      album: null,
      positionMs: null,
      durationMs: null,
      checkedAt: new Date().toISOString(),
      detail: null,
    }));
    const app = createApp(services);

    const toggle = await request(app).put("/api/auth/qr-display").send({ active: true });
    const loginPath = new URL(toggle.body.publicUrl).pathname;
    const login = await request(app).get(loginPath).set("x-show-manager-access", "public");
    const cookie = login.headers["set-cookie"];
    const response = await request(app).get("/api/youtube-queue").set("x-show-manager-access", "public").set("cookie", cookie);

    expect(login.status).toBe(302);
    expect(login.headers.location).toBe("/playlist-manager");
    expect(response.status).toBe(200);
  });

  it("blocks public admin api requests after qr login", async () => {
    const paths = await makeTempPaths();
    const services = createAppServices(makeConfig(paths.root), paths);
    services.raspController.showQrCode = vi.fn(async () => undefined);
    const app = createApp(services);

    const toggle = await request(app).put("/api/auth/qr-display").send({ active: true });
    const loginPath = new URL(toggle.body.publicUrl).pathname;
    const login = await request(app).get(loginPath).set("x-show-manager-access", "public");
    const cookie = login.headers["set-cookie"];
    const show = await request(app).get("/api/show").set("x-show-manager-access", "public").set("cookie", cookie);
    const library = await request(app).get("/api/library").set("x-show-manager-access", "public").set("cookie", cookie);
    const status = await request(app).get("/api/status").set("x-show-manager-access", "public").set("cookie", cookie);

    expect(show.status).toBe(403);
    expect(library.status).toBe(403);
    expect(status.status).toBe(403);
  });

  it("reports public and trusted access modes", async () => {
    const paths = await makeTempPaths();
    const services = createAppServices(makeConfig(paths.root), paths);
    services.raspController.showQrCode = vi.fn(async () => undefined);
    const app = createApp(services);

    const trusted = await request(app).get("/api/auth/access");
    const toggle = await request(app).put("/api/auth/qr-display").send({ active: true });
    const loginPath = new URL(toggle.body.publicUrl).pathname;
    const login = await request(app).get(loginPath).set("x-show-manager-access", "public");
    const cookie = login.headers["set-cookie"];
    const publicAccess = await request(app).get("/api/auth/access").set("x-show-manager-access", "public").set("cookie", cookie);

    expect(trusted.body).toEqual({ access: "trusted" });
    expect(publicAccess.body).toEqual({ access: "public" });
  });

  it("revokes qr token when display is hidden", async () => {
    const paths = await makeTempPaths();
    const services = createAppServices(makeConfig(paths.root), paths);
    services.raspController.showQrCode = vi.fn(async () => undefined);
    services.raspController.hideQrCode = vi.fn(async () => undefined);
    const app = createApp(services);

    const toggle = await request(app).put("/api/auth/qr-display").send({ active: true });
    const loginPath = new URL(toggle.body.publicUrl).pathname;
    await request(app).put("/api/auth/qr-display").send({ active: false });
    const login = await request(app).get(loginPath).set("x-show-manager-access", "public");

    expect(login.status).toBe(401);
  });
});
