import { Router } from "express";
import type { AppServices } from "../app.js";

export function createTvRouter(services: AppServices) {
  const router = Router();

  router.post("/api/tv/power-toggle", async (_request, response, next) => {
    try {
      await services.youtubeQueueScheduler.togglePower();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
