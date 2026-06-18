import { Router } from "express";
import type { ApiStatus } from "../../../shared/show-schema.js";
import { hashDraftShow } from "../services/show-state-store.js";
import type { AppServices } from "../app.js";

export function buildStatusResponse(args: {
  draft: Awaited<ReturnType<AppServices["store"]["getDraftShow"]>>;
  lastApplied: Awaited<ReturnType<AppServices["store"]["getLastApplied"]>>;
  remoteStatus: Awaited<ReturnType<AppServices["raspController"]["status"]>>;
  applyInProgress: boolean;
}): ApiStatus {
  const draftHash = hashDraftShow(args.draft);
  return {
    draftHash,
    isDirty: args.lastApplied?.draftHash !== draftHash,
    draft: args.draft,
    lastApplied: args.lastApplied,
    remoteStatus: args.remoteStatus,
    applyInProgress: args.applyInProgress,
  };
}

export function createStatusRouter(services: AppServices) {
  const router = Router();

  router.get("/status", (_request, response) => {
    response.type("text/plain").send("ok");
  });

  router.get("/api/status", async (_request, response, next) => {
    try {
      const [draft, lastApplied, remoteStatus] = await Promise.all([
        services.store.getDraftShow(),
        services.store.getLastApplied(),
        services.raspController.status(),
      ]);
      response.json(buildStatusResponse({ draft, lastApplied, remoteStatus, applyInProgress: services.runtime.applyInProgress }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
