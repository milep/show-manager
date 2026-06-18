import { Router } from "express";
import type { ApiStatus, DraftShow, LastApplied, RemoteStatus } from "../../../shared/show-schema.js";
import type { AppServices } from "../app.js";
import { hashDraftShow } from "../services/show-state-store.js";

type StatusResponseInput = {
  draft: DraftShow;
  lastApplied: LastApplied | null;
  remoteStatus: RemoteStatus;
  applyInProgress: boolean;
};

export function buildStatusResponse(args: StatusResponseInput): ApiStatus {
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
