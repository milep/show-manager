import { Router } from "express";
import multer from "multer";
import path from "node:path";
import type { AppServices } from "../app.js";

export function createLibraryRouter(services: AppServices) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: services.config.maxUploadBytes,
    },
  });

  router.get("/api/library", async (_request, response, next) => {
    try {
      response.json(await services.store.getLibrary());
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/library/upload", upload.single("file"), async (request, response, next) => {
    try {
      if (!request.file) {
        response.status(400).json({ error: "Missing file." });
        return;
      }
      const item = await services.mediaStore.saveUpload(request.file);
      response.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/:mediaId/thumb.jpg", async (request, response, next) => {
    try {
      const library = await services.store.getLibrary();
      const item = library.items.find((candidate) => candidate.id === request.params.mediaId);
      if (!item) {
        response.status(404).json({ error: "Media not found." });
        return;
      }
      response.sendFile(path.resolve(item.thumbnailPath));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
