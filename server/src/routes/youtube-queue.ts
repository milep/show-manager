import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { YoutubeQueueSnapshot } from "../../../shared/show-schema.js";
import type { AppServices } from "../app.js";
import { parseYoutubeLink, YoutubeLinkError } from "../services/youtube-link.js";

const addYoutubeItemSchema = z.object({
  url: z.string().min(1),
});

function nowIso() {
  return new Date().toISOString();
}

async function getPlaybackStatus(services: AppServices) {
  return services.youtubeQueueScheduler.getCachedPlaybackStatus() ?? services.adbYoutubeController.getPlaybackStatus();
}

async function buildSnapshot(services: AppServices): Promise<YoutubeQueueSnapshot> {
  const [queue, playback] = await Promise.all([
    services.store.getYoutubeQueue(),
    getPlaybackStatus(services),
  ]);
  return {
    queue,
    playback,
    scheduler: services.youtubeQueueScheduler.status(),
  };
}

export function createYoutubeQueueRouter(services: AppServices) {
  const router = Router();

  router.get("/api/youtube-queue", async (_request, response, next) => {
    try {
      response.json(await buildSnapshot(services));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/youtube-queue/items", async (request, response, next) => {
    try {
      const body = addYoutubeItemSchema.parse(request.body);
      const parsed = parseYoutubeLink(body.url);
      const queue = await services.store.getYoutubeQueue();
      const addedAt = nowIso();
      queue.items.push({
        id: randomUUID(),
        videoId: parsed.videoId,
        url: parsed.canonicalUrl,
        title: null,
        subtitle: null,
        addedAt,
        startedAt: null,
        completedAt: null,
      });
      queue.updatedAt = addedAt;
      await services.store.saveYoutubeQueue(queue);
      await services.youtubeQueueScheduler.tick();
      response.status(201).json(await buildSnapshot(services));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof YoutubeLinkError) {
        response.status(400).json({ error: error instanceof Error ? error.message : "Invalid YouTube queue item." });
        return;
      }
      next(error);
    }
  });

  router.post("/api/youtube-queue/skip", async (_request, response, next) => {
    try {
      const queue = await services.store.getYoutubeQueue();
      const now = nowIso();
      const current = queue.items.find((item) => item.id === queue.currentItemId);
      if (current) {
        current.completedAt = now;
      }
      queue.currentItemId = null;
      queue.updatedAt = now;
      await services.store.saveYoutubeQueue(queue);
      await services.youtubeQueueScheduler.tick();
      response.json(await buildSnapshot(services));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/youtube-queue/play", async (_request, response, next) => {
    try {
      await services.youtubeQueueScheduler.tick();
      response.json(await buildSnapshot(services));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
