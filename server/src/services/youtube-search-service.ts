import YTMusic from "ytmusic-api";
import type { SongDetailed, VideoDetailed } from "ytmusic-api";
import type { YoutubeSearchResponse, YoutubeSearchResult, YoutubeSearchSuggestionsResponse } from "../../../shared/show-schema.js";

export type YTMusicClient = {
  initialize(options?: { cookies?: string; GL?: string; HL?: string }): Promise<unknown>;
  searchSongs(query: string): Promise<SongDetailed[]>;
  searchVideos(query: string): Promise<VideoDetailed[]>;
  getSearchSuggestions(query: string): Promise<string[]>;
};

export type YoutubeDataApiClient = {
  searchVideos(query: string): Promise<YoutubeSearchResult[]>;
};

type VideoSearchResponse = {
  results: YoutubeSearchResult[];
  warning: string | null;
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

function parseIsoDurationMs(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

function durationMsText(durationMs: number | null): string | null {
  return durationMs === null ? null : durationText(durationMs / 1000);
}

function dedupeResults(results: YoutubeSearchResult[]): YoutubeSearchResult[] {
  const seen = new Set<string>();
  const deduped: YoutubeSearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.videoId)) continue;
    seen.add(result.videoId);
    deduped.push(result);
  }
  return deduped;
}

const youtubeDataErrorSchema = {
  message(data: unknown): string | null {
    if (typeof data !== "object" || data === null || !("error" in data)) return null;
    const error = (data as { error?: { message?: unknown; errors?: Array<{ reason?: unknown }> } }).error;
    const reason = error?.errors?.find((item) => typeof item.reason === "string")?.reason;
    const message = typeof error?.message === "string" ? error.message : null;
    return [reason, message].filter(Boolean).join(": ") || null;
  },
};

export class GoogleYoutubeDataApiClient implements YoutubeDataApiClient {
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async searchVideos(query: string): Promise<YoutubeSearchResult[]> {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("maxResults", "25");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("key", this.apiKey);

    const searchResponse = await this.fetchJson<YoutubeDataSearchResponse>(searchUrl);
    const ids = searchResponse.items.map((item) => item.id.videoId).filter(Boolean);
    if (!ids.length) return [];

    const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    detailsUrl.searchParams.set("part", "snippet,contentDetails");
    detailsUrl.searchParams.set("id", ids.join(","));
    detailsUrl.searchParams.set("key", this.apiKey);

    const detailsResponse = await this.fetchJson<YoutubeDataVideosResponse>(detailsUrl);
    const detailsById = new Map(detailsResponse.items.map((item) => [item.id, item]));

    return ids.flatMap((id) => {
      const item = detailsById.get(id);
      if (!item) return [];
      const durationMs = parseIsoDurationMs(item.contentDetails.duration);
      return [{
        kind: "video" as const,
        videoId: item.id,
        title: item.snippet.title,
        artists: [item.snippet.channelTitle],
        album: null,
        duration: durationMsText(durationMs),
        durationMs,
        thumbnails: Object.values(item.snippet.thumbnails ?? {}).map((thumbnail) => thumbnail.url),
      }];
    });
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    const response = await this.fetchImpl(url);
    const data = await response.json() as unknown;
    if (!response.ok) {
      throw new Error(youtubeDataErrorSchema.message(data) ?? `YouTube Data API request failed with status ${response.status}`);
    }
    return data as T;
  }
}

type YoutubeDataSearchResponse = {
  items: Array<{ id: { videoId: string }; snippet: unknown }>;
};

type YoutubeDataVideosResponse = {
  items: Array<{
    id: string;
    snippet: {
      title: string;
      channelTitle: string;
      thumbnails?: Record<string, { url: string }>;
    };
    contentDetails: { duration?: string };
  }>;
};

export class YoutubeSearchService {
  private readonly client: YTMusicClient;
  private readonly youtubeDataApiClient: YoutubeDataApiClient | null;
  private initializePromise: Promise<void> | null = null;

  constructor(client: YTMusicClient = new YTMusic(), youtubeDataApiClient: YoutubeDataApiClient | null = null) {
    this.client = client;
    this.youtubeDataApiClient = youtubeDataApiClient;
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
    const [videosResult, songsResult] = await Promise.allSettled([
      this.searchVideos(query),
      this.searchSongs(query),
    ]);

    const warnings: string[] = [];
    const results: YoutubeSearchResult[] = [];

    if (videosResult.status === "fulfilled") {
      results.push(...videosResult.value.results);
      if (videosResult.value.warning) warnings.push(videosResult.value.warning);
    } else {
      warnings.push(`video search failed: ${errorMessage(videosResult.reason)}`);
      logSearchError("YouTube Music video search failed", videosResult.reason);
    }

    if (songsResult.status === "fulfilled") {
      results.push(...songsResult.value);
    } else {
      warnings.push(`song search failed: ${errorMessage(songsResult.reason)}`);
      logSearchError("YouTube Music song search failed", songsResult.reason);
    }

    return { results: dedupeResults(results), warnings };
  }

  private async searchSongs(query: string): Promise<YoutubeSearchResult[]> {
    await this.initialize();
    return (await this.client.searchSongs(query)).map(normalizeSong);
  }

  private async searchVideos(query: string): Promise<VideoSearchResponse> {
    if (this.youtubeDataApiClient) {
      try {
        return { results: await this.youtubeDataApiClient.searchVideos(query), warning: null };
      } catch (error) {
        const message = `YouTube Data API video search failed; used YouTube Music fallback: ${errorMessage(error)}`;
        logSearchError("YouTube Data API video search failed; falling back to YouTube Music", error);
        await this.initialize();
        return { results: (await this.client.searchVideos(query)).map(normalizeVideo), warning: message };
      }
    }
    await this.initialize();
    return { results: (await this.client.searchVideos(query)).map(normalizeVideo), warning: null };
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
