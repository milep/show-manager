import type { YoutubePlaybackStatus, YoutubeQueueItem, YoutubeSchedulerStatus } from "../../../shared/show-schema.js";
import { YOUTUBE_TV_PACKAGE } from "../config.js";
import type { AdbYoutubeController } from "./adb-youtube-controller.js";
import type { YoutubeStore } from "./youtube-store.js";

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
  private running = false;
  private lastTickAt: string | null = null;
  private lastError: string | null = null;
  private lastPlaybackStatus: YoutubePlaybackStatus | null = null;

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

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastTickAt = new Date().toISOString();
    try {
      await this.advanceQueue();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "YouTube queue tick failed.";
    } finally {
      this.running = false;
    }
  }

  private async advanceQueue(): Promise<void> {
    const queue = this.store.getQueue();
    const currentItem = queue.items.find((item) => item.id === queue.currentItemId) ?? null;
    const playback = await this.adbYoutubeController.getPlaybackStatus();
    this.lastPlaybackStatus = playback;

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
