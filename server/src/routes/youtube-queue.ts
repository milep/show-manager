import { Router } from "express";
import { z } from "zod";
import type { YoutubeQueueSnapshot } from "../../../shared/show-schema.js";
import type { AppServices } from "../app.js";
import { parseYoutubeLink, YoutubeLinkError } from "../services/youtube-link.js";

const addYoutubeItemSchema = z.object({
  url: z.string().min(1),
});

const playlistSchema = z.object({
  name: z.string().min(1),
});

const loadPlaylistSchema = z.object({
  playlistId: z.string().min(1),
  mode: z.enum(["append", "replace"]).default("append"),
});

function isTrusted(request: import("express").Request) {
  return request.header("x-show-manager-access") !== "public";
}

function requireTrusted(request: import("express").Request, response: import("express").Response): boolean {
  if (isTrusted(request)) return true;
  response.status(403).json({ error: "Trusted access required." });
  return false;
}

async function getPlaybackStatus(services: AppServices) {
  return services.youtubeQueueScheduler.getCachedPlaybackStatus() ?? services.adbYoutubeController.getPlaybackStatus();
}

async function buildSnapshot(services: AppServices): Promise<YoutubeQueueSnapshot> {
  const [playback] = await Promise.all([getPlaybackStatus(services)]);
  return {
    queue: services.youtubeStore.getQueue(),
    playback,
    scheduler: services.youtubeQueueScheduler.status(),
  };
}

function mediaInputFromUrl(url: string) {
  const parsed = parseYoutubeLink(url);
  return {
    sourceId: parsed.videoId,
    url: parsed.canonicalUrl,
  };
}

function handleQueueInputError(error: unknown, response: import("express").Response, next: import("express").NextFunction) {
  if (error instanceof z.ZodError || error instanceof YoutubeLinkError) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid YouTube queue item." });
    return;
  }
  next(error);
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
      services.youtubeStore.addToQueue(mediaInputFromUrl(body.url), "end");
      await services.youtubeQueueScheduler.tick();
      response.status(201).json(await buildSnapshot(services));
    } catch (error) {
      handleQueueInputError(error, response, next);
    }
  });

  router.post("/api/youtube-queue/items/next", async (request, response, next) => {
    try {
      const body = addYoutubeItemSchema.parse(request.body);
      services.youtubeStore.addToQueue(mediaInputFromUrl(body.url), "next");
      await services.youtubeQueueScheduler.tick();
      response.status(201).json(await buildSnapshot(services));
    } catch (error) {
      handleQueueInputError(error, response, next);
    }
  });

  router.delete("/api/youtube-queue/items/:id", async (request, response, next) => {
    try {
      services.youtubeStore.removeQueueItem(request.params.id);
      response.json(await buildSnapshot(services));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/youtube-queue/skip", async (_request, response, next) => {
    try {
      services.youtubeStore.markCurrentCompleted();
      await services.youtubeQueueScheduler.tick();
      response.json(await buildSnapshot(services));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/youtube-queue/shuffle-rest", async (_request, response, next) => {
    try {
      services.youtubeStore.shuffleRest();
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

  router.get("/api/youtube/playlists", (request, response) => {
    if (!requireTrusted(request, response)) return;
    response.json({ items: services.youtubeStore.listPlaylists() });
  });

  router.post("/api/youtube/playlists", (request, response, next) => {
    try {
      if (!requireTrusted(request, response)) return;
      const body = playlistSchema.parse(request.body);
      response.status(201).json({ playlist: services.youtubeStore.createPlaylist(body.name) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.delete("/api/youtube/playlists/:id", (request, response) => {
    if (!requireTrusted(request, response)) return;
    services.youtubeStore.deletePlaylist(request.params.id);
    response.status(204).send();
  });

  router.post("/api/youtube-queue/load-playlist", async (request, response, next) => {
    try {
      if (!requireTrusted(request, response)) return;
      const body = loadPlaylistSchema.parse(request.body);
      services.youtubeStore.loadPlaylistToQueue(body.playlistId, body.mode);
      await services.youtubeQueueScheduler.tick();
      response.json(await buildSnapshot(services));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
