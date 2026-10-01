import type { YoutubePlaybackStatus, YoutubeQueueItem, YoutubeSchedulerStatus } from "../../../shared/show-schema.js";
import { YOUTUBE_TV_PACKAGE } from "../config.js";
import type { AdbYoutubeController } from "./adb-youtube-controller.js";
import type { AddYoutubeMediaInput, YoutubeStore } from "./youtube-store.js";

export type PresenterAction = "play" | "pause" | "next" | "start-pippalot" | "pause-tv-off";

const STARTUP_GRACE_MS = 15_000;
const PLAYBACK_STATUS_CACHE_MS = 3_000;

function activePlaybackState(state: YoutubePlaybackStatus["state"]): boolean {
  return state === "playing" || state === "paused" || state === "buffering";
}

function terminalPlaybackState(state: YoutubePlaybackStatus["state"]): boolean {
  return state === "idle" || state === "ended";
}

function optimisticPlaybackStatus(item: YoutubeQueueItem, checkedAt: string): YoutubePlaybackStatus {
  return {
    connected: true,
    state: "buffering",
    packageName: YOUTUBE_TV_PACKAGE,
    videoId: item.videoId,
    title: item.title,
    subtitle: item.subtitle,
    album: item.album,
    positionMs: 0,
    durationMs: null,
    checkedAt,
    detail: "Playback start requested.",
  };
}

export class YoutubeQueueScheduler {
  private timer: NodeJS.Timeout | null = null;
  private operations: Promise<unknown> = Promise.resolve();
  private pendingTick: Promise<void> | null = null;
  private lastTickAt: string | null = null;
  private lastError: string | null = null;
  private lastPlaybackStatus: YoutubePlaybackStatus | null = null;
  private readonly preparations = new Set<AbortController>();
  private readonly tvOperations = new Set<AbortController>();

  constructor(
    private readonly store: YoutubeStore,
    private readonly adbYoutubeController: AdbYoutubeController,
  ) {}

  status(): YoutubeSchedulerStatus {
    return {
      enabled: this.timer !== null,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
    };
  }

  private serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.operations.then(operation);
    // A failed ADB command must not poison later controls.
    this.operations = result.catch(() => undefined);
    return result;
  }

  private cancelPreparations(): void {
    for (const preparation of this.preparations) preparation.abort(new Error("TV start superseded."));
  }

  cancelPresenterPreparation(stillValid: () => boolean, lifetime: AbortSignal): void {
    // Coalescing another Off body must not suppress its newer cancellation intent.
    if (stillValid() && !lifetime.aborted) this.cancelPreparations();
  }

  control(action: PresenterAction, stillValid: () => boolean = () => true, lifetime?: AbortSignal): Promise<void> {
    if (action === "start-pippalot" || action === "pause-tv-off") {
      // Off enters immediately to supersede prep; its own serialized body may
      // wait longer than frame freshness while the cancelled child drains.
      const offAccepted = action === "pause-tv-off" && stillValid() && !lifetime?.aborted;
      if (offAccepted) this.cancelPreparations();
      const controller = new AbortController();
      const cancel = () => controller.abort(new Error("Presenter disconnected or stopped."));
      if (lifetime?.aborted) cancel();
      lifetime?.addEventListener("abort", cancel, { once: true });
      this.tvOperations.add(controller);
      if (action === "start-pippalot") this.preparations.add(controller);
      return this.serialize(async () => {
        // Freshness applies at entry only. Lifetime cancellation remains active
        // throughout preparation; a valid 30s wake is not a stale input frame.
        if (action === "start-pippalot" ? !stillValid() : !offAccepted) return;
        controller.signal.throwIfAborted();
        if (action === "start-pippalot") {
          await this.adbYoutubeController.prepareYoutube(controller.signal);
          controller.signal.throwIfAborted();
          this.preparations.delete(controller); // synchronous queue commit boundary
          await this.commitPippalot(false);
        } else {
          const power = await this.adbYoutubeController.getPowerState(controller.signal);
          controller.signal.throwIfAborted();
          if (power === "awake" || power === "dreaming") await this.adbYoutubeController.pause(controller.signal);
          this.store.setAutomationPaused(true);
          await this.adbYoutubeController.sleepAndVerify(controller.signal);
          this.lastError = null;
        }
      }).catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : "Presenter TV action failed.";
        throw error;
      }).finally(() => {
        this.preparations.delete(controller);
        this.tvOperations.delete(controller);
        lifetime?.removeEventListener("abort", cancel);
      });
    }
    return this.serialize(async () => {
      if (!stillValid() || lifetime?.aborted) return;
      if (action === "pause") {
        await this.adbYoutubeController.pause();
        this.store.setAutomationPaused(true);
      } else if (action === "play") {
        this.store.setAutomationPaused(false);
        await this.adbYoutubeController.play();
      } else {
        this.store.setAutomationPaused(false);
        this.store.markCurrentCompleted();
        await this.runTick();
      }
    });
  }

  addToQueue(input: AddYoutubeMediaInput, placement: "end" | "next"): Promise<void> {
    return this.serialize(async () => {
      this.store.addToQueue(input, placement);
      await this.runTick();
    });
  }

  removeQueueItem(id: string): Promise<void> {
    return this.serialize(() => { this.store.removeQueueItem(id); });
  }

  shuffleRest(): Promise<void> {
    return this.serialize(() => { this.store.shuffleRest(); });
  }

  clearQueue(): Promise<void> {
    return this.serialize(async () => {
      this.store.setAutomationPaused(false);
      this.store.clearQueue();
      await this.adbYoutubeController.pause();
    });
  }

  togglePower(): Promise<void> {
    this.cancelPreparations();
    return this.serialize(() => this.adbYoutubeController.togglePower());
  }

  loadPippalot(): Promise<{ queued: number }> {
    return this.serialize(() => this.commitPippalot(true));
  }

  private async commitPippalot(resumeBeforeLoad: boolean): Promise<{ queued: number }> {
    // Browser retains its original resume-first behavior. Presenter failure
    // before a successful cache transaction must preserve persisted pause.
    if (resumeBeforeLoad) this.store.setAutomationPaused(false);
    const result = this.store.loadPippalotToQueue();
    if (!resumeBeforeLoad) this.store.setAutomationPaused(false);
    await this.runTick(); // Existing launch failure/retry and lastError semantics.
    return result;
  }

  loadRadio(): Promise<{ queued: number }> {
    return this.serialize(async () => {
      this.store.setAutomationPaused(false);
      const result = this.store.loadConfirmedVideosToQueue();
      await this.runTick();
      return result;
    });
  }

  loadPlaylist(id: string, mode: "append" | "replace"): Promise<void> {
    return this.serialize(async () => {
      this.store.setAutomationPaused(false);
      this.store.loadPlaylistToQueue(id, mode);
      await this.runTick();
    });
  }

  getCachedPlaybackStatus(): YoutubePlaybackStatus | null {
    if (!this.lastPlaybackStatus) return null;
    if (Date.now() - Date.parse(this.lastPlaybackStatus.checkedAt) > PLAYBACK_STATUS_CACHE_MS) return null;
    return this.lastPlaybackStatus;
  }

  start(intervalMs = 5_000): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const operation of this.tvOperations) operation.abort(new Error("Scheduler stopped."));
    await this.operations;
  }

  tick(): Promise<void> {
    if (!this.pendingTick) {
      this.pendingTick = this.serialize(() => this.runTick()).finally(() => { this.pendingTick = null; });
    }
    return this.pendingTick;
  }

  private async runTick(): Promise<void> {
    this.lastTickAt = new Date().toISOString();
    try {
      await this.advanceQueue();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "YouTube queue tick failed.";
    }
  }

  private async advanceQueue(): Promise<void> {
    const queue = this.store.getQueue();
    const currentItem = queue.items.find((item) => item.id === queue.currentItemId) ?? null;
    const playback = await this.adbYoutubeController.getPlaybackStatus();
    this.lastPlaybackStatus = playback;

    if (this.store.isAutomationPaused()) {
      if (currentItem && activePlaybackState(playback.state)) {
        this.store.updateCurrentFromPlayback(playback);
      }
      return;
    }

    if (!currentItem) {
      await this.startNextPending();
      return;
    }

    if (activePlaybackState(playback.state)) {
      this.store.updateCurrentFromPlayback(playback);
      return;
    }

    if (!terminalPlaybackState(playback.state)) {
      return;
    }

    if (this.inStartupGrace()) {
      return;
    }

    this.store.completeCurrent();
    await this.startNextPending();
  }

  private async startNextPending(): Promise<void> {
    const nextItem = this.store.firstPending();
    if (!nextItem) return;
    this.lastPlaybackStatus = optimisticPlaybackStatus(nextItem, new Date().toISOString());
    await this.adbYoutubeController.playVideo(nextItem.videoId);
    this.store.markPlaying(nextItem.id);
  }

  private inStartupGrace(): boolean {
    const startedAt = this.store.currentStartedAt();
    if (!startedAt) return false;
    return Date.now() - Date.parse(startedAt) < STARTUP_GRACE_MS;
  }
}
