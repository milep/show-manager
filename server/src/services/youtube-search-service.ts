import YTMusic from "ytmusic-api";
import type { SongDetailed, VideoDetailed } from "ytmusic-api";
import type { YoutubeSearchResponse, YoutubeSearchResult, YoutubeSearchSuggestionsResponse } from "../../../shared/show-schema.js";

export type YTMusicClient = {
  initialize(options?: { cookies?: string; GL?: string; HL?: string }): Promise<unknown>;
  searchSongs(query: string): Promise<SongDetailed[]>;
  searchVideos(query: string): Promise<VideoDetailed[]>;
  getSearchSuggestions(query: string): Promise<string[]>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function errorStatus(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { status?: unknown } }).response;
    return typeof response?.status === "number" ? String(response.status) : null;
  }
  return null;
}

function logSearchError(label: string, error: unknown): void {
  const status = errorStatus(error);
  console.warn(`${label}: ${errorMessage(error)}${status ? ` status=${status}` : ""}`);
}

function durationText(durationSeconds: number | null): string | null {
  if (durationSeconds === null) return null;
  const totalSeconds = Math.round(durationSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function normalizeSong(item: SongDetailed): YoutubeSearchResult {
  return {
    kind: "song",
    videoId: item.videoId,
    title: item.name,
    artists: [item.artist.name],
    album: item.album?.name ?? null,
    duration: durationText(item.duration),
    durationMs: item.duration === null ? null : item.duration * 1000,
    thumbnails: item.thumbnails.map((thumbnail) => thumbnail.url),
  };
}

export function normalizeVideo(item: VideoDetailed): YoutubeSearchResult {
  return {
    kind: "video",
    videoId: item.videoId,
    title: item.name,
    artists: [item.artist.name],
    album: null,
    duration: durationText(item.duration),
    durationMs: item.duration === null ? null : item.duration * 1000,
    thumbnails: item.thumbnails.map((thumbnail) => thumbnail.url),
  };
}

export class YoutubeSearchService {
  private readonly client: YTMusicClient;
  private initializePromise: Promise<void> | null = null;

  constructor(client: YTMusicClient = new YTMusic()) {
    this.client = client;
  }

  async suggestions(query: string): Promise<YoutubeSearchSuggestionsResponse> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error("Search query is required.");
    }

    await this.initialize();
    return { suggestions: await this.client.getSearchSuggestions(trimmed) };
  }

  async search(query: string): Promise<YoutubeSearchResponse> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error("Search query is required.");
    }

    return this.searchInitialized(trimmed);
  }

  private async searchInitialized(query: string): Promise<YoutubeSearchResponse> {
    await this.initialize();
    const [songsResult, videosResult] = await Promise.allSettled([
      this.client.searchSongs(query),
      this.client.searchVideos(query),
    ]);

    const warnings: string[] = [];
    const results: YoutubeSearchResult[] = [];

    if (songsResult.status === "fulfilled") {
      results.push(...songsResult.value.map(normalizeSong));
    } else {
      warnings.push(`song search failed: ${errorMessage(songsResult.reason)}`);
      logSearchError("YouTube Music song search failed", songsResult.reason);
    }

    if (videosResult.status === "fulfilled") {
      results.push(...videosResult.value.map(normalizeVideo));
    } else {
      warnings.push(`video search failed: ${errorMessage(videosResult.reason)}`);
      logSearchError("YouTube Music video search failed", videosResult.reason);
    }

    return { results, warnings };
  }

  private initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.client.initialize({ GL: "US", HL: "en" }).then(() => undefined).catch((error: unknown) => {
        this.initializePromise = null;
        throw error;
      });
    }
    return this.initializePromise;
  }
}
