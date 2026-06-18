import type { YoutubePlaybackStatus, YoutubeQueueItem, YoutubeQueueState, YoutubeSchedulerStatus } from "../../../shared/show-schema.js";
import { YOUTUBE_TV_PACKAGE } from "../config.js";
import type { AdbYoutubeController } from "./adb-youtube-controller.js";
import type { ShowStateStore } from "./show-state-store.js";

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
    private readonly store: ShowStateStore,
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
    if (!this.lastPlaybackStatus) {
      return null;
    }
    if (Date.now() - Date.parse(this.lastPlaybackStatus.checkedAt) > PLAYBACK_STATUS_CACHE_MS) {
      return null;
    }
    return this.lastPlaybackStatus;
  }

  start(intervalMs = 5_000): void {
    if (this.timer) {
      return;
    }
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
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
    const queue = await this.store.getYoutubeQueue();
    const playback = await this.adbYoutubeController.getPlaybackStatus();
    this.lastPlaybackStatus = playback;

    const now = new Date().toISOString();
    const currentItem = this.findCurrentItem(queue);
    let changed = false;

    if (!currentItem) {
      const nextItem = this.findPendingItem(queue);
      if (!nextItem) {
        return;
      }
      await this.startItem(queue, nextItem, now);
      changed = true;
    } else if (activePlaybackState(playback.state)) {
      changed = this.updateCurrentMetadata(currentItem, playback);
    } else if (terminalPlaybackState(playback.state)) {
      if (this.inStartupGrace(currentItem)) {
        return;
      }
      this.completeItem(currentItem, now);
      const nextItem = this.findPendingItem(queue, currentItem.id);
      queue.currentItemId = nextItem?.id ?? null;
      if (nextItem) {
        await this.startItem(queue, nextItem, now);
      }
      changed = true;
    }

    if (changed) {
      queue.updatedAt = now;
      await this.store.saveYoutubeQueue(queue);
    }
  }

  private findCurrentItem(queue: YoutubeQueueState): YoutubeQueueItem | null {
    return queue.items.find((item) => item.id === queue.currentItemId) ?? null;
  }

  private findPendingItem(queue: YoutubeQueueState, excludedItemId?: string): YoutubeQueueItem | null {
    return queue.items.find((item) => !item.completedAt && item.id !== excludedItemId) ?? null;
  }

  private async startItem(queue: YoutubeQueueState, item: YoutubeQueueItem, now: string): Promise<void> {
    queue.currentItemId = item.id;
    item.startedAt = now;
    this.lastPlaybackStatus = optimisticPlaybackStatus(item, now);
    await this.adbYoutubeController.playVideo(item.videoId);
  }

  private updateCurrentMetadata(item: YoutubeQueueItem, playback: YoutubePlaybackStatus): boolean {
    let changed = false;
    if (playback.title && playback.title !== item.title) {
      item.title = playback.title;
      changed = true;
    }
    if (playback.subtitle && playback.subtitle !== item.subtitle) {
      item.subtitle = playback.subtitle;
      changed = true;
    }
    return changed;
  }

  private inStartupGrace(item: YoutubeQueueItem): boolean {
    if (!item.startedAt) {
      return false;
    }
    return Date.now() - Date.parse(item.startedAt) < STARTUP_GRACE_MS;
  }

  private completeItem(item: YoutubeQueueItem, now: string): void {
    item.completedAt = now;
  }
}
