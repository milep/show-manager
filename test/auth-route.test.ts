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

  it("allows public requests after qr login", async () => {
    const paths = await makeTempPaths();
    const services = createAppServices(makeConfig(paths.root), paths);
    services.raspController.showQrCode = vi.fn(async () => undefined);
    services.raspController.hideQrCode = vi.fn(async () => undefined);
    const app = createApp(services);

    const toggle = await request(app).put("/api/auth/qr-display").send({ active: true });
    const loginPath = new URL(toggle.body.publicUrl).pathname;
    const login = await request(app).get(loginPath).set("x-show-manager-access", "public");
    const cookie = login.headers["set-cookie"];
    const response = await request(app).get("/api/show").set("x-show-manager-access", "public").set("cookie", cookie);

    expect(login.status).toBe(302);
    expect(response.status).toBe(200);
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
