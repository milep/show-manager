import express, { type Express } from "express";
import path from "node:path";
import type { ShowManagerConfig } from "./config.js";
import type { DataRootPaths } from "./services/data-root.js";
import { MediaStore } from "./services/media-store.js";
import { PlaylistBundleService } from "./services/playlist-bundle.js";
import { AdbYoutubeController } from "./services/adb-youtube-controller.js";
import { RaspController } from "./services/rasp-controller.js";
import { ShowStateStore } from "./services/show-state-store.js";
import { AuthService } from "./services/auth-service.js";
import { ThumbnailService } from "./services/thumbnail-service.js";
import { createApplyRouter } from "./routes/apply.js";
import { createAuthApiRouter, createLoginRouter, requirePublicAuth } from "./routes/auth.js";
import { createLibraryRouter } from "./routes/library.js";
import { createShowRouter } from "./routes/show.js";
import { createStatusRouter } from "./routes/status.js";
import { createYoutubeQueueRouter } from "./routes/youtube-queue.js";
import { YoutubeQueueScheduler } from "./services/youtube-queue-scheduler.js";
import { YoutubeStore } from "./services/youtube-store.js";
import { GoogleYoutubeDataApiClient, YoutubeSearchService } from "./services/youtube-search-service.js";

export type AppServices = {
  config: ShowManagerConfig;
  paths: DataRootPaths;
  store: ShowStateStore;
  mediaStore: MediaStore;
  bundleService: PlaylistBundleService;
  raspController: RaspController;
  adbYoutubeController: AdbYoutubeController;
  youtubeQueueScheduler: YoutubeQueueScheduler;
  youtubeStore: YoutubeStore;
  youtubeSearchService: YoutubeSearchService;
  authService: AuthService;
  runtime: { applyInProgress: boolean };
};

export function createApp(services: AppServices): Express {
  const app = express();
  const webDistDir = path.resolve(import.meta.dirname, "../../../dist/web");

  app.use(express.json({ limit: "5mb" }));
  app.use(createLoginRouter(services));
  app.use(requirePublicAuth(services));
  app.use(createAuthApiRouter(services));
  app.use(createStatusRouter(services));
  app.use(createLibraryRouter(services));
  app.use(createShowRouter(services));
  app.use(createYoutubeQueueRouter(services));
  app.use(createApplyRouter(services));

  app.use(express.static(webDistDir));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(webDistDir, "index.html"));
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Internal server error";
    response.status(500).json({ error: message });
  });

  return app;
}

export function createAppServices(config: ShowManagerConfig, paths: DataRootPaths): AppServices {
  const store = new ShowStateStore(paths);
  const adbYoutubeController = new AdbYoutubeController(config);
  const youtubeStore = new YoutubeStore(paths);
  const youtubeDataApiClient = config.youtubeDataApiKey ? new GoogleYoutubeDataApiClient(config.youtubeDataApiKey) : null;
  return {
    config,
    paths,
    store,
    mediaStore: new MediaStore(paths, store, new ThumbnailService()),
    bundleService: new PlaylistBundleService(paths),
    raspController: new RaspController(config, paths, store),
    adbYoutubeController,
    youtubeQueueScheduler: new YoutubeQueueScheduler(youtubeStore, adbYoutubeController),
    youtubeStore,
    youtubeSearchService: new YoutubeSearchService(undefined, youtubeDataApiClient, youtubeStore),
    authService: new AuthService(config, paths),
    runtime: { applyInProgress: false },
  };
}
