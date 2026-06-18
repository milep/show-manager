import { Router } from "express";
import type { AppServices } from "../app.js";
import { parseCookie } from "../services/auth-service.js";

function wantsJson(path: string) {
  return path.startsWith("/api/");
}

function loginRequiredHtml() {
  return `<!doctype html><html><head><title>Show Manager login</title><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="font-family: system-ui; margin: 2rem; max-width: 36rem;"><h1>QR login required</h1><p>Ask the host to show the login QR code on the raspberrypi display.</p></body></html>`;
}

function loginResultHtml(message: string) {
  return `<!doctype html><html><head><title>Show Manager login</title><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="font-family: system-ui; margin: 2rem; max-width: 36rem;"><h1>${message}</h1><p><a href="/">Open Show Manager</a></p></body></html>`;
}

export function createLoginRouter(services: AppServices) {
  const router = Router();

  router.get("/auth/required", (_request, response) => {
    response.status(401).type("html").send(loginRequiredHtml());
  });

  router.get(["/q/:token", "/Q/:token", "/auth/qr-login/:token"], async (request, response, next) => {
    try {
      const token = request.params.token;
      if (typeof token !== "string") {
        response.status(401).type("html").send(loginResultHtml("QR code is no longer valid."));
        return;
      }
      const session = await services.authService.createSessionFromQrToken(token);
      if (!session) {
        response.status(401).type("html").send(loginResultHtml("QR code is no longer valid."));
        return;
      }
      response.cookie(services.config.sessionCookieName, session.token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        expires: new Date(session.expiresAt),
        path: "/",
      });
      response.redirect("/");
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createAuthApiRouter(services: AppServices) {
  const router = Router();

  router.get("/api/auth/qr-display", async (_request, response, next) => {
    try {
      response.json(await services.authService.getQrStatus());
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/auth/qr-display", async (request, response, next) => {
    try {
      if (typeof request.body?.active !== "boolean") {
        response.status(400).json({ error: "Expected boolean active." });
        return;
      }
      const current = await services.authService.getQrStatus();
      if (current.active === request.body.active) {
        response.json(current);
        return;
      }
      if (request.body.active) {
        const nextQr = await services.authService.enableQr();
        try {
          await services.raspController.showQrCode(nextQr.publicUrl);
        } catch (error) {
          await services.authService.disableQr();
          throw error;
        }
      } else {
        await services.authService.disableQr();
        await services.raspController.hideQrCode();
      }
      response.json(await services.authService.getQrStatus());
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function requirePublicAuth(services: AppServices) {
  return async (request: import("express").Request, response: import("express").Response, next: import("express").NextFunction) => {
    try {
      if (request.path === "/status") {
        next();
        return;
      }
      if (!services.config.publicAccessHeader || !services.config.publicAccessValue) {
        next();
        return;
      }
      const access = request.header(services.config.publicAccessHeader);
      if (access !== services.config.publicAccessValue) {
        next();
        return;
      }
      const sessionToken = parseCookie(request.headers.cookie, services.config.sessionCookieName);
      if (await services.authService.isValidSession(sessionToken)) {
        next();
        return;
      }
      if (wantsJson(request.path)) {
        response.status(401).json({ error: "QR login required." });
        return;
      }
      response.redirect("/auth/required");
    } catch (error) {
      next(error);
    }
  };
}
