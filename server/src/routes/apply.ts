import { Router } from "express";
import type { AppServices } from "../app.js";
import { buildStatusResponse } from "./status.js";

export function createApplyRouter(services: AppServices) {
  const router = Router();

  router.post("/api/show/apply", async (_request, response, next) => {
    if (services.runtime.applyInProgress) {
      response.status(409).json({ error: "Apply already running." });
      return;
    }

    services.runtime.applyInProgress = true;
    try {
      const [draft, library] = await Promise.all([services.store.getDraftShow(), services.store.getLibrary()]);
      const bundle = await services.bundleService.build(draft, library);
      const lastApplied = await services.raspController.applyBundle(bundle);
      const remoteStatus = await services.raspController.status();
      response.json(buildStatusResponse({ draft, lastApplied, remoteStatus, applyInProgress: false }));
    } catch (error) {
      console.error("show apply failed", error);
      try {
        const draft = await services.store.getDraftShow();
        const [lastApplied, remoteStatus] = await Promise.all([services.store.getLastApplied(), services.raspController.status()]);
        const failedLastApplied = error instanceof Error && lastApplied
          ? await services.store.saveLastApplied({ ...lastApplied, stderr: error.message, remoteStatus })
          : lastApplied;
        response.status(500).json(buildStatusResponse({ draft, lastApplied: failedLastApplied, remoteStatus, applyInProgress: false }));
      } catch (nestedError) {
        next(nestedError);
      }
    } finally {
      services.runtime.applyInProgress = false;
    }
  });

  return router;
}
