import { Router } from "express";
import { draftShowSchema } from "../../../shared/show-schema.js";
import type { AppServices } from "../app.js";
import { hashDraftShow } from "../services/show-state-store.js";

export function createShowRouter(services: AppServices) {
  const router = Router();

  router.get("/api/show", async (_request, response, next) => {
    try {
      const [draft, lastApplied] = await Promise.all([services.store.getDraftShow(), services.store.getLastApplied()]);
      const draftHash = hashDraftShow(draft);
      response.json({ draft, draftHash, isDirty: lastApplied?.draftHash !== draftHash });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/show", async (request, response, next) => {
    try {
      const draft = draftShowSchema.parse(request.body);
      const library = await services.store.getLibrary();
      const libraryIds = new Set(library.items.map((item) => item.id));
      for (const item of draft.playlist) {
        if (!libraryIds.has(item.sourceMediaId)) {
          response.status(400).json({ error: `Unknown media id: ${item.sourceMediaId}` });
          return;
        }
      }
      const saved = await services.store.saveDraftShow(draft);
      const lastApplied = await services.store.getLastApplied();
      const draftHash = hashDraftShow(saved);
      response.json({ draft: saved, draftHash, isDirty: lastApplied?.draftHash !== draftHash });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
